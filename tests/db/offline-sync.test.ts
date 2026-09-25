import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { POST } = await import("@/app/api/sync/route");
const { GET } = await import("@/app/api/sync/cache/route");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { isoDate } = await import("@/lib/format");
const { addDays } = await import("@/lib/follow-up-dates");
const { loadToday } = await import("@/lib/today");
const { listFollowUps, parseListFilters } = await import("@/lib/follow-up-list");
const { ALL_BRANCHES } = await import("@/lib/permissions");
const { CACHE_DAYS } = await import("@/lib/sync/cache");
const { makeCustomer, makeEnquiry, nextMobile } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs, viewingBranch } = await import("../helpers/session");
import type { EntryResult } from "@/lib/sync/entries";
import type { OfflineCache } from "@/lib/offline/types";
type TestStore = Awaited<ReturnType<typeof makeStore>>;

// M19: the phone's outbox replayed through /api/sync — same business rules as the
// Server Actions, one transaction per entry, no duplicates however often it is sent —
// and the offline copy served by /api/sync/cache. Two branches, two managers, two
// salespeople and an admin, every time.
let store: TestStore;
let sherwani: string;
let reason: string;

const DAY = 24 * 60 * 60 * 1000;
const today = () => isoDate(new Date());

beforeEach(async () => {
  store = await makeStore();
  sherwani = (
    await db.requirementCategory.create({
      data: { nameEn: "Sherwani", nameHi: "शेरवानी", nameGu: "શેરવાની", sortOrder: 1 },
    })
  ).id;
  reason = (
    await db.lostReason.create({
      data: { nameEn: "Price too high", nameHi: "Price", nameGu: "Price" },
    })
  ).id;
  await signInAs(store.salesA.mobile);
});

afterAll(() => db.$disconnect());

type Entry = {
  id: string;
  kind: string;
  at?: string;
  branchId?: string;
  input: Record<string, unknown>;
  seenPendingId?: string | null;
  force?: boolean;
};

async function sync(entries: Entry[]): Promise<{ status: number; results: EntryResult[] }> {
  const response = await POST(
    new Request("http://localhost/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "phone" },
      body: JSON.stringify({
        entries: entries.map((entry) => ({
          at: new Date().toISOString(),
          branchId: store.branchA.id,
          ...entry,
        })),
      }),
    }) as never,
  );
  const body = (await response.json()) as { results?: EntryResult[] };
  return { status: response.status, results: body.results ?? [] };
}

async function cache(): Promise<{
  status: number;
  key?: string;
  keyId?: string;
  cache?: OfflineCache;
}> {
  const response = await GET();
  return { status: response.status, ...((await response.json()) as object) };
}

// The three offline entries of "Done when": a new customer, their visit, a follow-up.
function newCustomerEntries(mobile = nextMobile()) {
  const customerId = randomUUID();
  const visitId = randomUUID();
  const followUpId = randomUUID();
  return {
    customerId,
    visitId,
    followUpId,
    entries: [
      {
        id: customerId,
        kind: "customer",
        input: {
          clientId: customerId,
          name: "Offline Asha",
          mobile,
          assignedToId: store.salesA.id,
          consentGiven: true,
        },
      },
      {
        id: visitId,
        kind: "visit",
        input: {
          clientId: visitId,
          customerId, // the phone's id for the new customer
          categoryIds: [sherwani],
          remarks: "Wants a sherwani",
          outcome: "DECIDE_LATER",
          followUp: {
            clientId: followUpId,
            dueDate: addDays(today(), 2),
            timeSlot: "EVENING",
            method: "CALL",
          },
        },
        seenPendingId: null,
      },
    ] as Entry[],
  };
}

describe("POST /api/sync", () => {
  it("syncs a customer, visit and follow-up made offline, and sending again makes no duplicates", async () => {
    const { customerId, visitId, followUpId, entries } = newCustomerEntries();

    const first = await sync(entries);
    expect(first.status).toBe(200);
    expect(first.results.map((result) => result.status)).toEqual(["ok", "ok"]);

    const customer = await db.customer.findUniqueOrThrow({ where: { clientId: customerId } });
    expect(customer).toMatchObject({
      name: "Offline Asha",
      enteredOffline: true,
      homeBranchId: store.branchA.id,
      assignedToId: store.salesA.id,
      createdById: store.salesA.id,
      consentGiven: true,
    });
    const visit = await db.visit.findUniqueOrThrow({ where: { clientId: visitId } });
    expect(visit).toMatchObject({
      customerId: customer.id,
      branchId: store.branchA.id,
      salespersonId: store.salesA.id,
      enteredOffline: true,
      outcome: "DECIDE_LATER",
      visitType: "NEW",
    });
    const followUp = await db.followUp.findUniqueOrThrow({ where: { clientId: followUpId } });
    expect(followUp).toMatchObject({
      customerId: customer.id,
      status: "PENDING",
      enteredOffline: true,
      assignedToId: store.salesA.id,
    });
    expect(isoDate(followUp.dueDate)).toBe(addDays(today(), 2));

    // The same audit and history rows as the online screens.
    const audit = await db.auditLog.findMany({
      where: { entityId: { in: [customer.id, visit.id] } },
      select: { action: true, userId: true, device: true },
    });
    expect(audit.map((row) => row.action).sort()).toEqual(
      [AUDIT.customerCreate, AUDIT.visitCreate].sort(),
    );
    expect(audit.every((row) => row.userId === store.salesA.id && row.device === "phone")).toBe(
      true,
    );
    expect(
      await db.timelineEvent.count({ where: { customerId: customer.id } }),
    ).toBeGreaterThanOrEqual(2);

    // The answer was lost; the phone sends everything again.
    const again = await sync(entries);
    expect(again.results.map((result) => result.status)).toEqual(["ok", "ok"]);
    expect(again.results[0]).toMatchObject({ data: { id: customer.id } });
    expect(await db.customer.count({ where: { mobile: customer.mobile } })).toBe(1);
    expect(await db.visit.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await db.followUp.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await db.enquiry.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("keeps the time the entry was made, never a time in the future", async () => {
    const customer = await makeCustomer(store.branchA.id, store.salesA.id);
    const yesterday = new Date(Date.now() - DAY);
    const id = randomUUID();
    const { results } = await sync([
      {
        id,
        kind: "visit",
        at: yesterday.toISOString(),
        input: {
          clientId: id,
          customerId: customer.id,
          categoryIds: [sherwani],
          outcome: "NOT_INTERESTED",
          lostReasonId: reason,
        },
      },
    ]);
    expect(results[0]?.status).toBe("ok");
    const visit = await db.visit.findUniqueOrThrow({ where: { clientId: id } });
    expect(visit.visitAt.getTime()).toBe(yesterday.getTime());

    const later = randomUUID();
    const future = new Date(Date.now() + 5 * DAY);
    await sync([
      {
        id: later,
        kind: "visit",
        at: future.toISOString(),
        input: {
          clientId: later,
          customerId: customer.id,
          categoryIds: [sherwani],
          outcome: "NOT_INTERESTED",
          lostReasonId: reason,
        },
      },
    ]);
    const clamped = await db.visit.findUniqueOrThrow({ where: { clientId: later } });
    expect(clamped.visitAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a follow-up due 'today' when saved offline yesterday is still accepted", async () => {
    const customer = await makeCustomer(store.branchA.id, store.salesA.id);
    await makeEnquiry(customer.id, store.salesA.id);
    const yesterday = new Date(Date.now() - DAY);
    const id = randomUUID();
    const { results } = await sync([
      {
        id,
        kind: "followUp",
        at: yesterday.toISOString(),
        input: {
          clientId: id,
          customerId: customer.id,
          followUp: { dueDate: isoDate(yesterday), timeSlot: "MORNING", method: "CALL" },
        },
      },
    ]);
    expect(results[0]?.status).toBe("ok");
    // …and it is overdue now (BR-09), on the salesperson's Today.
    const todayData = await loadToday(
      {
        id: store.salesA.id,
        role: "SALESPERSON",
        homeBranchId: store.branchA.id,
        branchIds: [store.branchA.id],
        language: "en",
      },
      new Date(),
    );
    expect(todayData.overdue.map((row) => row.customer.id)).toContain(customer.id);
  });

  it("catches a bill number used while offline, and syncs once it is changed", async () => {
    const other = await makeCustomer(store.branchA.id, store.salesA.id);
    const otherEnquiry = await makeEnquiry(other.id, store.salesA.id);
    await db.sale.create({
      data: {
        branchId: store.branchA.id,
        customerId: other.id,
        enquiryId: otherEnquiry.id,
        clientId: randomUUID(),
        billNumber: "B-100",
        billDate: new Date(`${today()}T00:00:00.000Z`),
        salespersonId: store.salesB.id,
      },
    });
    const customer = await makeCustomer(store.branchA.id, store.salesA.id);
    const visitId = randomUUID();
    const saleId = randomUUID();
    const entry: Entry = {
      id: visitId,
      kind: "visit",
      input: {
        clientId: visitId,
        customerId: customer.id,
        categoryIds: [sherwani],
        outcome: "PURCHASED",
        sale: { clientId: saleId, billNumber: "b-100", billDate: today(), billAmount: 2500 },
      },
    };

    const first = await sync([entry]);
    expect(first.results[0]).toMatchObject({
      status: "conflict",
      reason: "billTaken",
      message: "visits.errors.billTaken",
      values: { name: other.name },
    });
    // Nothing of it was written: the visit comes with its sale or not at all (BR-03).
    expect(await db.visit.count({ where: { clientId: visitId } })).toBe(0);
    expect(await db.sale.count({ where: { clientId: saleId } })).toBe(0);

    // The same bill number in branch B is a different bill (BR-07 is per branch).
    const inB = await sync([{ ...entry, branchId: store.branchB.id }]);
    expect(inB.results[0]?.status).toBe("error"); // salesA does not work in branch B

    const fixed = await sync([
      {
        ...entry,
        input: {
          ...entry.input,
          sale: { clientId: saleId, billNumber: "B-101", billDate: today(), billAmount: 2500 },
        },
      },
    ]);
    expect(fixed.results[0]?.status).toBe("ok");
    const sale = await db.sale.findUniqueOrThrow({ where: { clientId: saleId } });
    expect(sale).toMatchObject({
      billNumber: "B-101",
      enteredOffline: true,
      customerId: customer.id,
    });
    expect(Number(sale.billAmount)).toBe(2500);
  });

  it("a number that exists already: conflict with the existing customer, and the visit waits", async () => {
    const existing = await makeCustomer(store.branchB.id, store.salesB.id);
    const { customerId, visitId, entries } = newCustomerEntries(existing.mobile!);

    const { results } = await sync(entries);
    expect(results[0]).toMatchObject({
      status: "conflict",
      reason: "mobileTaken",
      values: { name: existing.name, id: existing.id },
    });
    expect(results[1]).toEqual({ id: visitId, status: "blocked" });
    expect(await db.customer.count({ where: { clientId: customerId } })).toBe(0);

    // "Use existing customer": the visit goes to them instead.
    const moved = await sync([
      {
        ...entries[1]!,
        input: { ...entries[1]!.input, customerId: existing.id },
        seenPendingId: null,
      },
    ]);
    expect(moved.results[0]?.status).toBe("ok");
    const visit = await db.visit.findUniqueOrThrow({ where: { clientId: visitId } });
    // Shared customer (BR-16): visited in branch A, belongs to branch B.
    expect(visit).toMatchObject({ customerId: existing.id, branchId: store.branchA.id });
  });

  it("someone else updated the follow-up first: alreadyUpdated, nothing written", async () => {
    const customer = await makeCustomer(store.branchA.id, store.salesA.id);
    const enquiry = await makeEnquiry(customer.id, store.salesA.id);
    const followUp = await db.followUp.create({
      data: {
        branchId: store.branchA.id,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${today()}T00:00:00.000Z`),
        timeSlot: "EVENING",
        method: "CALL",
        assignedToId: store.salesA.id,
        createdFrom: "PROFILE",
      },
    });
    await db.followUp.update({
      where: { id: followUp.id },
      data: { status: "DONE", result: "CALL_LATER", completedById: store.managerA.id },
    });

    const id = randomUUID();
    const { results } = await sync([
      { id, kind: "result", input: { id: followUp.id, clientId: id, result: "NOT_REACHABLE" } },
    ]);
    expect(results[0]).toMatchObject({ status: "conflict", reason: "alreadyUpdated" });
    expect(await db.followUp.count({ where: { clientId: id } })).toBe(0);
  });

  it("asks before replacing a follow-up someone else set since, and saves when told to", async () => {
    const customer = await makeCustomer(store.branchA.id, store.salesA.id);
    const enquiry = await makeEnquiry(customer.id, store.salesA.id);
    // What the phone saw: no pending follow-up. Then the manager set one.
    const managers = await db.followUp.create({
      data: {
        branchId: store.branchA.id,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${addDays(today(), 3)}T00:00:00.000Z`),
        timeSlot: "MORNING",
        method: "VISIT",
        assignedToId: store.salesA.id,
        createdFrom: "PROFILE",
      },
    });
    const id = randomUUID();
    const entry: Entry = {
      id,
      kind: "followUp",
      input: {
        clientId: id,
        customerId: customer.id,
        followUp: { dueDate: addDays(today(), 1), timeSlot: "EVENING", method: "CALL" },
      },
      seenPendingId: null,
    };
    const asked = await sync([entry]);
    expect(asked.results[0]).toMatchObject({ status: "conflict", reason: "customerChanged" });
    expect((await db.followUp.findUniqueOrThrow({ where: { id: managers.id } })).status).toBe(
      "PENDING",
    );

    const forced = await sync([{ ...entry, force: true }]);
    expect(forced.results[0]?.status).toBe("ok");
    expect((await db.followUp.findUniqueOrThrow({ where: { id: managers.id } })).status).toBe(
      "RESCHEDULED",
    );

    // When the phone saw that same one, no question is asked.
    const seen = randomUUID();
    const current = await db.followUp.findUniqueOrThrow({ where: { clientId: id } });
    const next = await sync([
      {
        id: seen,
        kind: "followUp",
        input: {
          clientId: seen,
          customerId: customer.id,
          followUp: { dueDate: addDays(today(), 4), timeSlot: "EVENING", method: "CALL" },
        },
        seenPendingId: current.id,
      },
    ]);
    expect(next.results[0]?.status).toBe("ok");
  });

  it("a branch the person does not work in, or a closed one, takes nothing", async () => {
    const { entries } = newCustomerEntries();
    const wrong = await sync(entries.map((entry) => ({ ...entry, branchId: store.branchB.id })));
    expect(wrong.results[0]).toMatchObject({ status: "error", message: "branch.errors.noAccess" });
    expect(wrong.results[1]?.status).toBe("blocked");

    await signInAs(store.managerA.mobile);
    const manager = await sync(
      newCustomerEntries().entries.map((e) => ({ ...e, branchId: store.branchB.id })),
    );
    expect(manager.results[0]).toMatchObject({
      status: "error",
      message: "branch.errors.noAccess",
    });

    // An admin reaches every branch.
    await signInAs(store.admin.mobile);
    const admin = newCustomerEntries();
    const adminResult = await sync(
      admin.entries.map((entry) =>
        entry.kind === "customer"
          ? {
              ...entry,
              branchId: store.branchB.id,
              input: { ...entry.input, assignedToId: store.salesB.id },
            }
          : { ...entry, branchId: store.branchB.id },
      ),
    );
    expect(adminResult.results.map((result) => result.status)).toEqual(["ok", "ok"]);

    await db.branch.update({ where: { id: store.branchB.id }, data: { status: "INACTIVE" } });
    const closed = await sync(
      newCustomerEntries().entries.map((e) => ({ ...e, branchId: store.branchB.id })),
    );
    expect(closed.results[0]).toMatchObject({ status: "error", message: "branch.errors.noAccess" });
  });

  it("a clientId from someone else's phone is not a way into their customer", async () => {
    const { customerId, entries } = newCustomerEntries();
    expect((await sync(entries.slice(0, 1))).results[0]?.status).toBe("ok");

    await signInAs(store.salesB.mobile);
    const visitId = randomUUID();
    const { results } = await sync([
      {
        id: visitId,
        kind: "visit",
        branchId: store.branchB.id,
        input: {
          clientId: visitId,
          customerId,
          categoryIds: [sherwani],
          outcome: "NOT_INTERESTED",
          lostReasonId: reason,
        },
      },
    ]);
    expect(results[0]?.status).toBe("blocked");
    expect(await db.visit.count({ where: { clientId: visitId } })).toBe(0);
  });

  it("bad input is an error for that entry only; the others still sync", async () => {
    const customer = await makeCustomer(store.branchA.id, store.salesA.id);
    const good = randomUUID();
    const { results } = await sync([
      { id: randomUUID(), kind: "customer", input: { name: "", mobile: "123" } },
      {
        id: good,
        kind: "visit",
        input: {
          clientId: good,
          customerId: customer.id,
          categoryIds: [sherwani],
          outcome: "NOT_INTERESTED",
          lostReasonId: reason,
        },
      },
    ]);
    expect(results.map((result) => result.status)).toEqual(["error", "ok"]);
  });

  it("answers 401 without a session and 400 for a malformed body", async () => {
    await signInAs(null);
    expect((await sync(newCustomerEntries().entries)).status).toBe(401);
    expect((await cache()).status).toBe(401);

    await signInAs(store.salesA.mobile);
    const response = await POST(
      new Request("http://localhost/api/sync", { method: "POST", body: "{nope" }) as never,
    );
    expect(response.status).toBe(400);
    const tooMany = await POST(
      new Request("http://localhost/api/sync", {
        method: "POST",
        body: JSON.stringify({ entries: [] }),
      }) as never,
    );
    expect(tooMany.status).toBe(400);
  });

  it("what one salesperson syncs, their manager and the admin see — the other branch does not", async () => {
    const { followUpId, entries } = newCustomerEntries();
    await sync(entries);
    const followUp = await db.followUp.findUniqueOrThrow({ where: { clientId: followUpId } });

    const person = (user: {
      id: string;
      role: "SALESPERSON" | "MANAGER" | "ADMIN";
      homeBranchId: string;
    }) => ({
      id: user.id,
      role: user.role,
      homeBranchId: user.homeBranchId,
      branchIds: [user.homeBranchId],
      language: "en" as const,
    });
    const filters = parseListFilters({ tab: "pending" });
    const seen = async (
      user: Parameters<typeof person>[0],
      scope: Parameters<typeof listFollowUps>[1],
    ) =>
      (await listFollowUps(person(user), scope, filters, new Date())).rows.some(
        (row) => row.id === followUp.id,
      );

    expect(await seen(store.salesA as never, { all: false, branchIds: [store.branchA.id] })).toBe(
      true,
    );
    expect(await seen(store.managerA as never, { all: false, branchIds: [store.branchA.id] })).toBe(
      true,
    );
    expect(await seen(store.admin as never, { all: true })).toBe(true);
    expect(await seen(store.admin as never, { all: false, branchIds: [store.branchA.id] })).toBe(
      true,
    );
    expect(await seen(store.managerB as never, { all: false, branchIds: [store.branchB.id] })).toBe(
      false,
    );
    expect(await seen(store.salesB as never, { all: false, branchIds: [store.branchB.id] })).toBe(
      false,
    );
  });
});

describe("GET /api/sync/cache", () => {
  it("holds this salesperson's customers of the last 90 days and today's follow-ups, nobody else's", async () => {
    const mine = await makeCustomer(store.branchA.id, store.salesA.id);
    const theirs = await makeCustomer(store.branchB.id, store.salesB.id);
    const old = await makeCustomer(store.branchA.id, store.salesA.id);
    const long = new Date(Date.now() - (CACHE_DAYS + 5) * DAY);
    await db.customer.update({ where: { id: old.id }, data: { updatedAt: long, createdAt: long } });
    // An old customer with a follow-up today is still on the phone.
    const oldWithFollowUp = await makeCustomer(store.branchA.id, store.salesA.id);
    await db.customer.update({
      where: { id: oldWithFollowUp.id },
      data: { updatedAt: long, createdAt: long },
    });
    const enquiry = await makeEnquiry(oldWithFollowUp.id, store.salesA.id);
    await db.followUp.create({
      data: {
        branchId: store.branchA.id,
        customerId: oldWithFollowUp.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${today()}T00:00:00.000Z`),
        timeSlot: "MORNING",
        method: "CALL",
        assignedToId: store.salesA.id,
        createdFrom: "PROFILE",
      },
    });

    const body = await cache();
    expect(body.status).toBe(200);
    const ids = body.cache!.customers.map((customer) => customer.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(oldWithFollowUp.id);
    expect(ids).not.toContain(theirs.id);
    expect(ids).not.toContain(old.id);
    expect(body.cache!.followUps.map((row) => row.customerId)).toEqual([oldWithFollowUp.id]);
    const cached = body.cache!.customers.find((customer) => customer.id === oldWithFollowUp.id)!;
    expect(cached).toMatchObject({ openEnquiryTitle: "Wedding", mobile: oldWithFollowUp.mobile });
    expect(cached.pending?.dueDate).toBe(today());
    expect(body.cache!.user).toMatchObject({ id: store.salesA.id, role: "SALESPERSON" });
    expect(body.cache!.branch?.id).toBe(store.branchA.id);
    expect(body.cache!.lists.staff.map((person) => person.id)).toContain(store.salesA.id);
    expect(body.cache!.lists.staff.map((person) => person.id)).not.toContain(store.salesB.id);
    expect(body.cache!.lists.categories.map((item) => item.id)).toContain(sherwani);
  });

  it("the key belongs to the session: the same for one login, new for the next", async () => {
    const one = await cache();
    const two = await cache();
    expect(one.key).toBe(two.key);
    expect(one.keyId).toBe(two.keyId);
    expect(Buffer.from(one.key!, "base64")).toHaveLength(32);

    await signInAs(store.salesA.mobile);
    const next = await cache();
    expect(next.keyId).not.toBe(one.keyId);
  });

  it("an admin on 'All branches' gets no branch to write to; lists follow the language", async () => {
    await signInAs(store.admin.mobile);
    viewingBranch(ALL_BRANCHES);
    const all = await cache();
    expect(all.cache!.branch).toBeNull();
    expect(all.cache!.lists.staff).toEqual([]);

    await db.user.update({ where: { id: store.salesA.id }, data: { language: "hi" } });
    await signInAs(store.salesA.mobile);
    const hindi = await cache();
    expect(hindi.cache!.user.language).toBe("hi");
    expect(hindi.cache!.lists.categories.find((item) => item.id === sherwani)?.name).toBe(
      "शेरवानी",
    );
  });
});
