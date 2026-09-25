import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  FollowUpResult,
  FollowUpStatus,
  VisitOutcome,
  VisitType,
} from "@/generated/prisma/client";

const { db } = await import("@/lib/db");
const { loadAlerts, loadOverview } = await import("@/lib/dashboard");
const { parsePeriod } = await import("@/lib/dashboard-period");
const { addDays } = await import("@/lib/follow-up-dates");
const { makeUser } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");

// M12: every tile, the table and the alerts on a hand-counted store — two branches, two
// managers, two salespeople and an admin. A fixed day far from every other test file's
// data, so the period counts are exactly this file's rows.
const D = "2033-03-16"; // a Wednesday
let store: Awaited<ReturnType<typeof makeStore>>;
let inactiveB: { id: string };
const ids: Record<string, string> = {};

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const ist = (day: string, time: string) => new Date(`${day}T${time}:00.000+05:30`);
const A = () => ({ scope: { all: false as const, branchIds: [store.branchA.id] } });
const B = () => ({ scope: { all: false as const, branchIds: [store.branchB.id] } });
const today = { from: D, to: D };

async function customer(ownerId: string, branchId: string, key: string) {
  const c = await db.customer.create({
    data: {
      name: `Dash ${key}`,
      mobile: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      assignedToId: ownerId,
      homeBranchId: branchId,
    },
  });
  const e = await db.enquiry.create({
    data: { customerId: c.id, assignedToId: ownerId, title: "Wedding" },
  });
  return { customerId: c.id, enquiryId: e.id };
}

async function visit(
  who: string,
  branchId: string,
  key: string,
  at: Date,
  type: VisitType,
  outcome: VisitOutcome = "DECIDE_LATER",
  lostReasonId?: string,
  existing?: { customerId: string; enquiryId: string },
) {
  const c = existing ?? (await customer(who, branchId, key));
  await db.visit.create({
    data: {
      ...c,
      branchId,
      clientId: randomUUID(),
      visitAt: at,
      salespersonId: who,
      visitType: type,
      outcome,
      lostReasonId: lostReasonId ?? null,
    },
  });
  return c;
}

async function followUp(
  who: string,
  branchId: string,
  key: string,
  due: string,
  status: FollowUpStatus = "PENDING",
  extra: { result?: FollowUpResult; notReachableCount?: number; completedAt?: Date } = {},
) {
  const c = await customer(who, branchId, key);
  const f = await db.followUp.create({
    data: {
      ...c,
      branchId,
      clientId: randomUUID(),
      dueDate: utc(due),
      timeSlot: "EVENING",
      method: "CALL",
      assignedToId: who,
      createdFrom: "VISIT",
      status,
      ...extra,
      ...(status === "DONE"
        ? { completedAt: extra.completedAt ?? ist(D, "11:00"), completedById: who }
        : {}),
    },
  });
  ids[key] = f.id;
  return { ...c, followUpId: f.id };
}

async function sale(
  who: string,
  branchId: string,
  key: string,
  billDay: string,
  fromFollowUp: boolean,
  cancelled = false,
) {
  const c = await customer(who, branchId, key);
  await db.sale.create({
    data: {
      ...c,
      branchId,
      clientId: randomUUID(),
      billNumber: `D-${randomUUID().slice(0, 10)}`,
      billDate: utc(billDay),
      salespersonId: who,
      fromFollowUp,
      cancelled,
    },
  });
}

beforeAll(async () => {
  store = await makeStore();
  const a = store.branchA.id;
  const b = store.branchB.id;
  const sA = store.salesA.id;
  const sB = store.salesB.id;
  const reason = (nameEn: string) =>
    db.lostReason.create({ data: { nameEn, nameHi: `${nameEn} हि`, nameGu: `${nameEn} ગુ` } });
  const [price, design] = [
    await reason(`Price ${randomUUID().slice(0, 4)}`),
    await reason("Design"),
  ];
  ids.price = price.id;

  // Branch A, visits on D: c1 NEW; c2 twice (one customer, two visits); c4 at 23:30 IST
  // (still D); two not-interested visits for the price. Not counted: c3 on D-1, c5 at
  // 00:10 IST on D+1.
  await visit(sA, a, "c1", ist(D, "10:00"), "NEW");
  const c2 = await visit(sA, a, "c2", ist(D, "11:00"), "EXISTING");
  await visit(sA, a, "c2", ist(D, "17:00"), "EXISTING", "DECIDE_LATER", undefined, c2);
  await visit(sA, a, "c3", ist(addDays(D, -1), "12:00"), "NEW");
  await visit(sA, a, "c4", ist(D, "23:30"), "EXISTING");
  await visit(sA, a, "c5", ist(addDays(D, 1), "00:10"), "EXISTING");
  await visit(sA, a, "lost1", ist(D, "12:00"), "EXISTING", "NOT_INTERESTED", price.id);
  await visit(sA, a, "lost2", ist(D, "13:00"), "EXISTING", "NOT_INTERESTED", price.id);

  // Follow-ups due on D: pending, done, done-as-not-interested; rescheduled and cancelled
  // do not count. Overdue: 5 days (a long-overdue alert) and 2 days with 3 missed calls.
  await followUp(sA, a, "f1", D);
  await followUp(sA, a, "f2", D, "DONE", { result: "WILL_VISIT" });
  const lostCall = await followUp(sA, a, "f7", D, "DONE", { result: "NOT_INTERESTED" });
  await db.enquiry.update({
    where: { id: lostCall.enquiryId },
    data: { status: "NOT_INTERESTED", lostReasonId: design.id, closedAt: ist(D, "11:00") },
  });
  await followUp(sA, a, "f3", D, "RESCHEDULED");
  await followUp(sA, a, "f4", D, "CANCELLED");
  await followUp(sA, a, "f5", addDays(D, -5));
  await followUp(sA, a, "f6", addDays(D, -2), "PENDING", { notReachableCount: 3 });

  // Sales: two on D (one from a follow-up); a cancelled one and yesterday's do not count.
  await sale(sA, a, "s1", D, true);
  await sale(sA, a, "s2", D, false);
  await sale(sA, a, "s3", D, true, true);
  await sale(sA, a, "s4", addDays(D, -1), false);

  // Branch B: one new visitor, one sale, one follow-up a day late, and a salesperson who
  // left with a pending follow-up still theirs.
  await visit(sB, b, "b1", ist(D, "10:00"), "NEW");
  await sale(sB, b, "bs1", D, false);
  await followUp(sB, b, "bf1", addDays(D, -1));
  inactiveB = await makeUser({ role: "SALESPERSON", homeBranchId: b });
  await followUp(inactiveB.id, b, "bf2", addDays(D, 1));
  await db.user.update({ where: { id: inactiveB.id }, data: { status: "INACTIVE" } });
});

afterAll(() => db.$disconnect());

describe("loadOverview (M12 tiles and table)", () => {
  it("branch A, today: each tile by its definition", async () => {
    const o = await loadOverview(A().scope, today, D, "en");
    expect(o.visited).toEqual({ total: 5, new: 1, existing: 4 }); // c1, c2, c4, lost1, lost2
    expect(o.sales).toEqual({ total: 2, fromFollowUps: 1 });
    expect(o.due).toEqual({ total: 3, done: 2 }); // f1, f2, f7
    expect(o.overdue).toBe(2); // f5, f6
    expect(o.notInterested.total).toBe(3); // two visits + one call
    expect(o.notInterested.topReason).toMatch(/^Price /);
    expect(o.conversionPercent).toBe(20); // 1 ÷ (2 sales + 3 not interested)

    // Only the active salesperson of A; the manager has no numbers of their own.
    expect(o.people).toEqual([
      {
        id: store.salesA.id,
        name: store.salesA.fullName,
        active: true,
        departmentId: null,
        visits: 6,
        newCustomers: 1, // c1 (c3 was yesterday)
        notInterested: 3, // two visits and the call they completed
        due: 3,
        done: 2,
        overdue: 2,
        sales: 2,
        conversions: 1,
        conversionPercent: 20,
      },
    ]);
  });

  it("the top reason is in the reader's language", async () => {
    const o = await loadOverview(A().scope, today, D, "gu");
    expect(o.notInterested.topReason).toMatch(/ગુ$/);
  });

  it("branch B sees none of A's numbers", async () => {
    const o = await loadOverview(B().scope, today, D, "en");
    expect(o.visited).toEqual({ total: 1, new: 1, existing: 0 });
    expect(o.sales).toEqual({ total: 1, fromFollowUps: 0 });
    expect(o.due).toEqual({ total: 0, done: 0 });
    expect(o.overdue).toBe(1);
    expect(o.notInterested).toEqual({ total: 0, topReason: null });
    expect(o.conversionPercent).toBe(0);
    expect(o.people.map((p) => p.id)).toEqual([store.salesB.id]);
  });

  it("all branches for the period adds A and B", async () => {
    const o = await loadOverview({ all: true }, today, D, "en");
    expect(o.visited.total).toBe(6);
    expect(o.sales.total).toBe(3);
    expect(o.due.total).toBe(3);
    // Overdue is "as of now" over the whole database, so other files' rows count too.
    expect(o.overdue).toBeGreaterThanOrEqual(3);
  });

  it("a longer period takes in yesterday's visitor and sale", async () => {
    const { range } = parsePeriod({ period: "custom", from: addDays(D, -1), to: D }, D);
    const o = await loadOverview(A().scope, range, D, "en");
    expect(o.visited).toEqual({ total: 6, new: 2, existing: 4 });
    expect(o.sales.total).toBe(3);
    // Overdue does not move with the period.
    expect(o.overdue).toBe(2);
  });
});

describe("loadAlerts (M12.04)", () => {
  it("branch A: 3 missed calls and more than 3 days late", async () => {
    const alerts = await loadAlerts(A().scope, D);
    expect(alerts.notReachable.count).toBe(1);
    expect(alerts.notReachable.rows.map((row) => row.id)).toEqual([ids.f6]);
    expect(alerts.longOverdue.count).toBe(1);
    expect(alerts.longOverdue.rows.map((row) => row.id)).toEqual([ids.f5]);
    expect(alerts.inactiveStaff).toEqual([]);
  });

  it("branch B: the inactive salesperson still holding a follow-up", async () => {
    const alerts = await loadAlerts(B().scope, D);
    expect(alerts.notReachable.count).toBe(0);
    expect(alerts.longOverdue.count).toBe(0); // one day late only
    expect(alerts.inactiveStaff).toEqual([
      { id: inactiveB.id, name: expect.any(String), followUps: 1 },
    ]);
  });
});
