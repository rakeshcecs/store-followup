import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { reassignCustomers } = await import("@/lib/actions/reassign");
const { setStaffStatus } = await import("@/app/(app)/staff/actions");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { TIMELINE, readReassignDetail } = await import("@/lib/timeline");
const { openCustomersOf, reassignSources, reassignTargets } = await import("@/lib/reassign");
const { openWorkFor } = await import("@/lib/staff-work");
const { accessScope } = await import("@/lib/permissions");
const { makeUser } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
const { signInAs } = await import("../helpers/session");

// M15: moving customers between salespeople, and the staff exit. Two branches, two
// managers, two salespeople and an admin, every time.
let store: TestStore;

const DAY = 24 * 60 * 60 * 1000;
const calendar = (offset: number) => {
  const d = new Date(Date.now() + offset * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// A customer of `ownerId` with an open enquiry, one pending follow-up, one done
// follow-up, a visit and a sale — the whole shape a reassignment has to get right.
async function book(
  ownerId: string,
  branchId: string,
  name = `Customer ${randomUUID().slice(0, 6)}`,
) {
  const customer = await db.customer.create({
    data: {
      name,
      mobile: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      assignedToId: ownerId,
      homeBranchId: branchId,
    },
  });
  const enquiry = await db.enquiry.create({
    data: { customerId: customer.id, assignedToId: ownerId, title: "Wedding" },
  });
  const base = { branchId, customerId: customer.id, enquiryId: enquiry.id };
  const pending = await db.followUp.create({
    data: {
      ...base,
      clientId: randomUUID(),
      dueDate: calendar(2),
      timeSlot: "EVENING",
      method: "CALL",
      assignedToId: ownerId,
      createdFrom: "VISIT",
    },
  });
  const done = await db.followUp.create({
    data: {
      ...base,
      clientId: randomUUID(),
      dueDate: calendar(-2),
      timeSlot: "MORNING",
      method: "CALL",
      assignedToId: ownerId,
      createdFrom: "VISIT",
      status: "DONE",
      completedAt: new Date(),
    },
  });
  const visit = await db.visit.create({
    data: {
      ...base,
      clientId: randomUUID(),
      visitAt: new Date(),
      salespersonId: ownerId,
      outcome: "DECIDE_LATER",
      visitType: "NEW",
    },
  });
  const sale = await db.sale.create({
    data: {
      ...base,
      clientId: randomUUID(),
      billNumber: `R-${randomUUID().slice(0, 8)}`,
      billDate: calendar(0),
      salespersonId: ownerId,
    },
  });
  return { customer, enquiry, pending, done, visit, sale };
}

// A second salesperson in branch A: within one branch is where most handovers happen.
async function colleagueA() {
  return makeUser({ role: "SALESPERSON", homeBranchId: store.branchA.id });
}

beforeEach(async () => {
  store = await makeStore();
});

afterAll(() => db.$disconnect());

describe("reassignCustomers", () => {
  it("moves the customer, open enquiry and pending follow-ups; history and credit stay", async () => {
    const to = await colleagueA();
    const a = await book(store.salesA.id, store.branchA.id);
    await signInAs(store.managerA.mobile);

    const result = await reassignCustomers({
      fromId: store.salesA.id,
      toId: to.id,
      customerIds: [a.customer.id],
    });
    expect(result).toMatchObject({
      ok: true,
      data: { customers: 1, followUps: 1, deactivated: false },
    });

    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: a.customer.id } })).assignedToId,
    ).toBe(to.id);
    expect((await db.enquiry.findUniqueOrThrow({ where: { id: a.enquiry.id } })).assignedToId).toBe(
      to.id,
    );
    expect(
      (await db.followUp.findUniqueOrThrow({ where: { id: a.pending.id } })).assignedToId,
    ).toBe(to.id);
    // History and credit keep the person who earned them.
    expect((await db.followUp.findUniqueOrThrow({ where: { id: a.done.id } })).assignedToId).toBe(
      store.salesA.id,
    );
    expect((await db.visit.findUniqueOrThrow({ where: { id: a.visit.id } })).salespersonId).toBe(
      store.salesA.id,
    );
    expect((await db.sale.findUniqueOrThrow({ where: { id: a.sale.id } })).salespersonId).toBe(
      store.salesA.id,
    );

    // M15.03 timeline row, by the manager, with both names; one audit row per customer.
    const events = await db.timelineEvent.findMany({
      where: { customerId: a.customer.id, type: TIMELINE.reassigned.type },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.staffId).toBe(store.managerA.id);
    expect(readReassignDetail(events[0]!.detail)).toEqual({
      from: store.salesA.fullName,
      to: to.fullName,
    });
    const audit = await db.auditLog.findMany({
      where: { entityId: a.customer.id, action: AUDIT.customerReassign },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      userId: store.managerA.id,
      oldValue: { assignedToId: store.salesA.id },
      newValue: { assignedToId: to.id, followUps: 1 },
    });
  });

  it("moves only the ticked customers", async () => {
    const to = await colleagueA();
    const [a1, a2] = [
      await book(store.salesA.id, store.branchA.id),
      await book(store.salesA.id, store.branchA.id),
    ];
    await signInAs(store.managerA.mobile);
    await reassignCustomers({
      fromId: store.salesA.id,
      toId: to.id,
      customerIds: [a1.customer.id],
    });
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: a2.customer.id } })).assignedToId,
    ).toBe(store.salesA.id);
    expect(
      (await db.followUp.findUniqueOrThrow({ where: { id: a2.pending.id } })).assignedToId,
    ).toBe(store.salesA.id);
  });

  it("moves a pending follow-up on someone else's customer, not the customer", async () => {
    const to = await colleagueA();
    // managerA's customer, with a follow-up assigned to salesA.
    const m = await book(store.managerA.id, store.branchA.id);
    await db.followUp.update({
      where: { id: m.pending.id },
      data: { assignedToId: store.salesA.id },
    });
    expect((await openCustomersOf(store.salesA.id)).map((row) => row.id)).toContain(m.customer.id);

    await signInAs(store.managerA.mobile);
    const result = await reassignCustomers({
      fromId: store.salesA.id,
      toId: to.id,
      customerIds: [m.customer.id],
    });
    expect(result).toMatchObject({ ok: true, data: { customers: 1, followUps: 1 } });
    expect(
      (await db.followUp.findUniqueOrThrow({ where: { id: m.pending.id } })).assignedToId,
    ).toBe(to.id);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: m.customer.id } })).assignedToId,
    ).toBe(store.managerA.id);
  });

  it("follows the salesperson's follow-ups into the other branch", async () => {
    const to = await colleagueA();
    const a = await book(store.salesA.id, store.branchA.id);
    // A visit in branch B filed the next follow-up there, still salesA's (M08.08).
    await db.followUp.update({ where: { id: a.pending.id }, data: { branchId: store.branchB.id } });
    await signInAs(store.managerA.mobile);
    await reassignCustomers({ fromId: store.salesA.id, toId: to.id, customerIds: [a.customer.id] });
    expect(
      (await db.followUp.findUniqueOrThrow({ where: { id: a.pending.id } })).assignedToId,
    ).toBe(to.id);
  });

  it("keeps a manager inside their own branches, both ends", async () => {
    const a = await book(store.salesA.id, store.branchA.id);
    const b = await book(store.salesB.id, store.branchB.id);
    await signInAs(store.managerA.mobile);

    // From a branch-B salesperson: not theirs to see.
    expect(
      await reassignCustomers({
        fromId: store.salesB.id,
        toId: (await colleagueA()).id,
        customerIds: [b.customer.id],
      }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // To a branch-B salesperson: likewise.
    expect(
      await reassignCustomers({
        fromId: store.salesA.id,
        toId: store.salesB.id,
        customerIds: [a.customer.id],
      }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: a.customer.id } })).assignedToId,
    ).toBe(store.salesA.id);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: b.customer.id } })).assignedToId,
    ).toBe(store.salesB.id);

    // The screen's lists agree: managerA sees only branch A people.
    const scope = accessScope({ ...store.managerA, branchIds: [] } as never);
    const sources = (await reassignSources(scope)).map((person) => person.id);
    expect(sources).toContain(store.salesA.id);
    expect(sources).not.toContain(store.salesB.id);
    const targets = (await reassignTargets(scope)).map((person) => person.id);
    expect(targets).toContain(store.salesA.id);
    expect(targets).not.toContain(store.salesB.id);
    expect(targets).not.toContain(store.managerA.id);
  });

  it("lets an admin move work between branches", async () => {
    const a = await book(store.salesA.id, store.branchA.id);
    await signInAs(store.admin.mobile);
    const result = await reassignCustomers({
      fromId: store.salesA.id,
      toId: store.salesB.id,
      customerIds: [a.customer.id],
    });
    expect(result).toMatchObject({ ok: true, data: { customers: 1 } });
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: a.customer.id } })).assignedToId,
    ).toBe(store.salesB.id);
  });

  it("only gives customers to an active salesperson", async () => {
    const a = await book(store.salesA.id, store.branchA.id);
    await signInAs(store.managerA.mobile);
    // Not a salesperson.
    expect(
      await reassignCustomers({
        fromId: store.salesA.id,
        toId: store.managerA.id,
        customerIds: [a.customer.id],
      }),
    ).toMatchObject({ ok: false, code: "RULE", message: "reassign.errors.toNotActive" });
    // Inactive.
    const gone = await colleagueA();
    await db.user.update({ where: { id: gone.id }, data: { status: "INACTIVE" } });
    expect(
      await reassignCustomers({
        fromId: store.salesA.id,
        toId: gone.id,
        customerIds: [a.customer.id],
      }),
    ).toMatchObject({ ok: false, code: "RULE", message: "reassign.errors.toNotActive" });
    // The same person at both ends.
    expect(
      await reassignCustomers({
        fromId: store.salesA.id,
        toId: store.salesA.id,
        customerIds: [a.customer.id],
      }),
    ).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("is not for a salesperson", async () => {
    const a = await book(store.salesA.id, store.branchA.id);
    await signInAs(store.salesA.mobile);
    expect(
      await reassignCustomers({
        fromId: store.salesA.id,
        toId: (await colleagueA()).id,
        customerIds: [a.customer.id],
      }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("skips a customer somebody moved in the meantime", async () => {
    const [to, other] = [await colleagueA(), await colleagueA()];
    const a = await book(store.salesA.id, store.branchA.id);
    await signInAs(store.managerA.mobile);
    await reassignCustomers({
      fromId: store.salesA.id,
      toId: other.id,
      customerIds: [a.customer.id],
    });
    // A second tab still showing salesA's list.
    expect(
      await reassignCustomers({
        fromId: store.salesA.id,
        toId: to.id,
        customerIds: [a.customer.id],
      }),
    ).toMatchObject({ ok: false, code: "RULE", message: "reassign.errors.nothingToMove" });
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: a.customer.id } })).assignedToId,
    ).toBe(other.id);
  });
});

describe("staff exit (M15.02)", () => {
  it("moves everything and deactivates in one step; no pending follow-up is left on them", async () => {
    const to = await colleagueA();
    const books = [
      await book(store.salesA.id, store.branchA.id),
      await book(store.salesA.id, store.branchA.id),
    ];
    await signInAs(store.admin.mobile);

    const result = await reassignCustomers({
      fromId: store.salesA.id,
      toId: to.id,
      customerIds: books.map((b) => b.customer.id),
      deactivate: true,
    });
    expect(result).toMatchObject({
      ok: true,
      data: { customers: 2, followUps: 2, deactivated: true },
    });

    const leaver = await db.user.findUniqueOrThrow({ where: { id: store.salesA.id } });
    expect(leaver.status).toBe("INACTIVE");
    expect(await db.session.count({ where: { userId: store.salesA.id } })).toBe(0);
    expect(await openWorkFor(db, store.salesA.id)).toEqual({ customers: 0, followUps: 0 });
    expect(
      await db.auditLog.count({
        where: { entityId: store.salesA.id, action: AUDIT.userDeactivate },
      }),
    ).toBe(1);

    // "Done when": no PENDING follow-up is assigned to an inactive user — this store's.
    const people = Object.values(store)
      .filter((value): value is typeof store.salesA => "role" in value)
      .map((person) => person.id)
      .concat(to.id);
    expect(
      await db.followUp.count({
        where: {
          status: "PENDING",
          assignedToId: { in: people },
          assignedTo: { status: "INACTIVE" },
        },
      }),
    ).toBe(0);
  });

  it("changes nothing at all if anything would be left behind", async () => {
    const to = await colleagueA();
    const [a1, a2] = [
      await book(store.salesA.id, store.branchA.id),
      await book(store.salesA.id, store.branchA.id),
    ];
    await signInAs(store.admin.mobile);
    const result = await reassignCustomers({
      fromId: store.salesA.id,
      toId: to.id,
      customerIds: [a1.customer.id],
      deactivate: true,
    });
    expect(result).toMatchObject({ ok: false, code: "RULE", message: "reassign.errors.workLeft" });
    // Rolled back: a1 still salesA's, and salesA still active.
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: a1.customer.id } })).assignedToId,
    ).toBe(store.salesA.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: store.salesA.id } })).status).toBe(
      "ACTIVE",
    );
    expect(await db.timelineEvent.count({ where: { customerId: a2.customer.id } })).toBe(0);
  });

  it("is admin only, like every status change", async () => {
    const to = await colleagueA();
    const a = await book(store.salesA.id, store.branchA.id);
    await signInAs(store.managerA.mobile);
    expect(
      await reassignCustomers({
        fromId: store.salesA.id,
        toId: to.id,
        customerIds: [a.customer.id],
        deactivate: true,
      }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await db.user.findUniqueOrThrow({ where: { id: store.salesA.id } })).status).toBe(
      "ACTIVE",
    );
  });

  it("the plain Deactivate still refuses while work is left, and works once it is moved", async () => {
    const to = await colleagueA();
    const a = await book(store.salesA.id, store.branchA.id);
    await signInAs(store.admin.mobile);
    expect(await setStaffStatus({ id: store.salesA.id, status: "INACTIVE" })).toMatchObject({
      ok: false,
      message: "staff.errors.reassignFirst",
    });
    await reassignCustomers({ fromId: store.salesA.id, toId: to.id, customerIds: [a.customer.id] });
    expect(await setStaffStatus({ id: store.salesA.id, status: "INACTIVE" })).toMatchObject({
      ok: true,
    });
  });
});
