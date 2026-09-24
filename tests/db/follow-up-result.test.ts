import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { recordFollowUpResult } = await import("@/lib/actions/follow-up");
const { recordSale } = await import("@/lib/actions/sale");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { TIMELINE, FOLLOW_UP_CALL_TITLE } = await import("@/lib/timeline");
const { customerTimeline } = await import("@/lib/customers");
const { isoDate } = await import("@/lib/format");
const { expectBranchIsolated, makeCustomer, makeEnquiry, makeUser } =
  await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
const { signInAs } = await import("../helpers/session");

// M09: what happened on a follow-up. Two branches, two managers, two salespeople and an
// admin, every time.
let store: TestStore;
let customer: Awaited<ReturnType<typeof makeCustomer>>;
let enquiryId: string;
let followUpId: string;
let reason: string;

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => isoDate(new Date(Date.now() + offset * DAY));

async function pendingFollowUp(extra: { notReachableCount?: number } = {}) {
  const row = await db.followUp.create({
    data: {
      branchId: store.branchA.id,
      customerId: customer.id,
      enquiryId,
      clientId: randomUUID(),
      dueDate: new Date(`${day(0)}T00:00:00.000Z`),
      timeSlot: "AFTERNOON",
      method: "WHATSAPP",
      reason: "Show the new sherwanis",
      assignedToId: store.salesA.id,
      createdFrom: "VISIT",
      ...extra,
    },
  });
  return row.id;
}

const result = (extra: Record<string, unknown>) => ({
  id: followUpId,
  clientId: randomUUID(),
  ...extra,
});

async function nextOf(outcome: Awaited<ReturnType<typeof recordFollowUpResult>>) {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.code} ${outcome.message}`);
  if (!outcome.data.nextFollowUpId) throw new Error("expected a next follow-up");
  return db.followUp.findUniqueOrThrow({ where: { id: outcome.data.nextFollowUpId } });
}

const old = () => db.followUp.findUniqueOrThrow({ where: { id: followUpId } });
const pendingCount = () =>
  db.followUp.count({ where: { customerId: customer.id, status: "PENDING" } });

beforeEach(async () => {
  store = await makeStore();
  customer = await makeCustomer(store.branchA.id, store.salesA.id);
  enquiryId = (await makeEnquiry(customer.id, store.salesA.id)).id;
  followUpId = await pendingFollowUp();
  reason = (
    await db.lostReason.create({
      data: { nameEn: "Bought elsewhere", nameHi: "Elsewhere", nameGu: "Elsewhere" },
    })
  ).id;
  await signInAs(store.salesA.mobile);
});

afterAll(() => db.$disconnect());

describe("the five results (M09.03–M09.10)", () => {
  it("will visit: Done, and a new follow-up on that day, method Visit, same slot", async () => {
    const next = await nextOf(
      await recordFollowUpResult(
        result({ result: "WILL_VISIT", nextDate: day(3), note: "Coming with family" }),
      ),
    );

    const done = await old();
    expect(done.status).toBe("DONE");
    expect(done.result).toBe("WILL_VISIT");
    expect(done.resultNote).toBe("Coming with family");
    expect(done.completedById).toBe(store.salesA.id);
    expect(done.completedAt).toBeInstanceOf(Date);

    expect(next.status).toBe("PENDING");
    expect(isoDate(next.dueDate)).toBe(day(3));
    expect(next.method).toBe("VISIT");
    expect(next.timeSlot).toBe("AFTERNOON");
    expect(next.createdFrom).toBe("FOLLOWUP_RESULT");
    expect(next.assignedToId).toBe(store.salesA.id);
    expect(next.branchId).toBe(store.branchA.id);
    expect(next.enquiryId).toBe(enquiryId);
    expect(await pendingCount()).toBe(1);

    // One history line, "Follow-up call · Spoke, will visit <day>", pointing at the new one.
    const events = await db.timelineEvent.findMany({ where: { customerId: customer.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(TIMELINE.followUpResult.type);
    expect(events[0]?.title).toBe(FOLLOW_UP_CALL_TITLE.WILL_VISIT);
    expect(events[0]?.entityId).toBe(next.id);
    expect(events[0]?.detail).toBe("Coming with family");
    const { events: shown } = await customerTimeline(customer.id, 10);
    expect(isoDate(shown[0]!.followUp!.dueDate)).toBe(day(3));

    expect(
      await db.auditLog.count({ where: { entityId: followUpId, action: AUDIT.followUpResult } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: next.id, action: AUDIT.followUpCreate } }),
    ).toBe(1);
  });

  it("call later: a new follow-up by phone on the chosen day", async () => {
    const next = await nextOf(
      await recordFollowUpResult(result({ result: "CALL_LATER", nextDate: day(5) })),
    );

    expect((await old()).result).toBe("CALL_LATER");
    expect(isoDate(next.dueDate)).toBe(day(5));
    expect(next.method).toBe("CALL");
    expect(next.timeSlot).toBe("AFTERNOON");
  });

  it("not reachable: tomorrow, the same way, counting the misses", async () => {
    const next = await nextOf(await recordFollowUpResult(result({ result: "NOT_REACHABLE" })));

    expect((await old()).result).toBe("NOT_REACHABLE");
    expect(isoDate(next.dueDate)).toBe(day(1));
    expect(next.method).toBe("WHATSAPP");
    expect(next.notReachableCount).toBe(1);
  });

  it("not interested: closes the enquiry with the reason, nothing stays pending", async () => {
    const outcome = await recordFollowUpResult(
      result({ result: "NOT_INTERESTED", lostReasonId: reason, note: "Got it cheaper" }),
    );

    expect(outcome.ok && outcome.data.nextFollowUpId).toBe(null);
    expect((await old()).result).toBe("NOT_INTERESTED");
    const enquiry = await db.enquiry.findUniqueOrThrow({ where: { id: enquiryId } });
    expect(enquiry.status).toBe("NOT_INTERESTED");
    expect(enquiry.lostReasonId).toBe(reason);
    expect(await pendingCount()).toBe(0);
    const event = await db.timelineEvent.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(event.title).toBe(FOLLOW_UP_CALL_TITLE.NOT_INTERESTED);
    expect(event.detail).toBe("Bought elsewhere · Got it cheaper");
  });

  it("not interested needs a reason (M09.08)", async () => {
    await expect(
      recordFollowUpResult(result({ result: "NOT_INTERESTED", lostReasonId: " " })),
    ).resolves.toMatchObject({ ok: false, code: "VALIDATION", field: "lostReasonId" });
    expect((await old()).status).toBe("PENDING");
  });

  it("already bought: Done only with the sale, and linked to it (M09.07, BR-11)", async () => {
    // Not a result this action takes: it is saved with its sale.
    await expect(recordFollowUpResult(result({ result: "ALREADY_BOUGHT" }))).resolves.toMatchObject(
      { ok: false },
    );
    expect((await old()).status).toBe("PENDING");

    const saved = await recordSale({
      clientId: randomUUID(),
      customerId: customer.id,
      sale: { billNumber: `INV-${randomUUID().slice(0, 6)}`, billDate: day(0), billAmount: 900 },
      followUpId,
      followUpNote: "Bought on Sunday",
    });
    if (!saved.ok) throw new Error(saved.message);

    const done = await old();
    expect(done.status).toBe("DONE");
    expect(done.result).toBe("ALREADY_BOUGHT");
    expect(done.resultNote).toBe("Bought on Sunday");
    const sale = await db.sale.findUniqueOrThrow({ where: { id: saved.data.saleId } });
    expect(sale.linkedFollowUpId).toBe(followUpId);
    expect(sale.fromFollowUp).toBe(true);
    const titles = (await db.timelineEvent.findMany({ where: { customerId: customer.id } })).map(
      (event) => event.title,
    );
    expect(titles).toContain(FOLLOW_UP_CALL_TITLE.ALREADY_BOUGHT);
    expect(titles).toContain(TIMELINE.saleCompleted.title);
  });

  it("refuses a next day in the past", async () => {
    await expect(
      recordFollowUpResult(result({ result: "CALL_LATER", nextDate: day(-1) })),
    ).resolves.toMatchObject({ ok: false, message: "visits.errors.dueDatePast" });
    expect((await old()).status).toBe("PENDING");
  });
});

describe("three missed calls in a row (M09.06)", () => {
  const alerts = () => db.notification.count({ where: { type: "followup-missed" } });

  it("tells the branch's managers and the admins once, on the third", async () => {
    const before = await alerts();

    const first = await nextOf(await recordFollowUpResult(result({ result: "NOT_REACHABLE" })));
    followUpId = first.id;
    const second = await nextOf(await recordFollowUpResult(result({ result: "NOT_REACHABLE" })));
    expect(second.notReachableCount).toBe(2);
    expect(await alerts()).toBe(before);

    followUpId = second.id;
    const third = await nextOf(await recordFollowUpResult(result({ result: "NOT_REACHABLE" })));
    expect(third.notReachableCount).toBe(3);

    const rows = await db.notification.findMany({
      where: { type: "followup-missed", message: { contains: customer.id } },
    });
    const told = rows.map((row) => row.userId);
    expect(told).toContain(store.managerA.id);
    expect(told).toContain(store.admin.id);
    expect(told).not.toContain(store.managerB.id);
    expect(told).not.toContain(store.salesA.id);
    expect(rows.every((row) => row.link === `/customers/${customer.id}`)).toBe(true);

    // A fourth miss does not raise it again.
    followUpId = third.id;
    const fourth = await nextOf(await recordFollowUpResult(result({ result: "NOT_REACHABLE" })));
    expect(fourth.notReachableCount).toBe(4);
    expect(
      await db.notification.count({
        where: { type: "followup-missed", message: { contains: customer.id } },
      }),
    ).toBe(rows.length);
  });

  it("starts counting again after any other result", async () => {
    await db.followUp.delete({ where: { id: followUpId } });
    followUpId = await pendingFollowUp({ notReachableCount: 2 });

    const next = await nextOf(
      await recordFollowUpResult(result({ result: "CALL_LATER", nextDate: day(2) })),
    );

    expect(next.notReachableCount).toBe(0);
  });
});

describe("safety", () => {
  it("records a result once, however many times it is sent", async () => {
    const input = result({ result: "CALL_LATER", nextDate: day(2) });

    const first = await recordFollowUpResult(input);
    const again = await recordFollowUpResult(input);

    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) expect(again.data).toEqual(first.data);
    expect(await db.followUp.count({ where: { customerId: customer.id } })).toBe(2);
  });

  it("refuses a second, different result on a follow-up already done", async () => {
    await nextOf(await recordFollowUpResult(result({ result: "NOT_REACHABLE" })));

    await expect(
      recordFollowUpResult(result({ result: "CALL_LATER", nextDate: day(2) })),
    ).resolves.toMatchObject({ ok: false, message: "followUpResult.errors.alreadyUpdated" });
  });

  it("lets only one of two people saving at the same moment through", async () => {
    await signInAs(store.managerA.mobile);

    const outcomes = await Promise.all([
      recordFollowUpResult(result({ result: "CALL_LATER", nextDate: day(2) })),
      recordFollowUpResult(result({ result: "WILL_VISIT", nextDate: day(4) })),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(await pendingCount()).toBe(1);
    expect(await db.followUp.count({ where: { customerId: customer.id } })).toBe(2);
  });
});

describe("who may update it (SOW 3, 3.1)", () => {
  const callLater = () => result({ result: "CALL_LATER", nextDate: day(2) });

  it("the salesperson it is assigned to, a manager of its branch, an admin", async () => {
    for (const person of [store.salesA, store.managerA, store.admin]) {
      await db.followUp.updateMany({
        where: { customerId: customer.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      followUpId = await pendingFollowUp();
      await signInAs(person.mobile);

      expect((await recordFollowUpResult(callLater())).ok, person.role).toBe(true);
    }
  });

  it("the customer's own salesperson, even when the follow-up sits in the other branch", async () => {
    // A Branch B visit files the next follow-up in B; it stays with the customer's
    // salesperson from A (M08.08), who must still reach it (found in cross-branch checks).
    await db.followUp.update({ where: { id: followUpId }, data: { branchId: store.branchB.id } });

    expect((await recordFollowUpResult(callLater())).ok).toBe(true);
  });

  it("not another branch's salesperson or manager", async () => {
    for (const person of [store.salesB, store.managerB]) {
      await signInAs(person.mobile);
      await expectBranchIsolated(recordFollowUpResult, callLater());
    }
    expect((await old()).status).toBe("PENDING");
  });

  it("not a colleague in the same branch it is not assigned to", async () => {
    const colleague = await makeUser({ role: "SALESPERSON", homeBranchId: store.branchA.id });
    await signInAs(colleague.mobile);

    await expect(recordFollowUpResult(callLater())).resolves.toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it("not through the sale either", async () => {
    await signInAs(store.salesB.mobile);

    await expectBranchIsolated(recordSale, {
      clientId: randomUUID(),
      customerId: customer.id,
      sale: { billNumber: `INV-${randomUUID().slice(0, 6)}`, billDate: day(0), billAmount: 900 },
      followUpId,
    });
    expect(await db.sale.count({ where: { customerId: customer.id } })).toBe(0);
    expect((await old()).status).toBe("PENDING");
  });
});
