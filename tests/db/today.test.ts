import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { FollowUpStatus, TimeSlot } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { countFollowUps, LIST_PAGE, listFollowUps, parseListFilters } from "@/lib/follow-up-list";
import { formatMobile } from "@/lib/format";
import { ALL_BRANCHES, branchScope } from "@/lib/permissions";
import { loadToday } from "@/lib/today";
import { makeCustomer, makeEnquiry } from "../helpers/branch-access";
import { makeStore, type TestStore } from "../helpers/store";

// M11: the Today screen and the Follow-ups list, on a fixed clock. Two branches, two
// managers, two salespeople and an admin, every time.
//
// "Today" is a day far from the real one, so nothing another test file leaves behind
// can land in these lists by date.
const D = "2031-03-12"; // a Wednesday
// Noon in the shop (IST = UTC+5:30) on a given calendar day.
const noonOn = (day: string) => new Date(`${day}T06:30:00.000Z`);
const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

let store: TestStore;

function session(user: { id: string; role: SessionUser["role"]; homeBranchId: string }) {
  return {
    id: user.id,
    role: user.role,
    homeBranchId: user.homeBranchId,
    branchIds: [user.homeBranchId],
    language: "en",
  } satisfies SessionUser;
}

// Every follow-up needs its own customer: BR-02 allows one pending follow-up each.
async function followUp(options: {
  due: string;
  assignedToId: string;
  branchId: string;
  slot?: TimeSlot;
  status?: FollowUpStatus;
  createdAt?: Date;
  notReachableCount?: number;
  customerName?: string;
}) {
  const customer = await makeCustomer(options.branchId, options.assignedToId);
  if (options.customerName) {
    await db.customer.update({ where: { id: customer.id }, data: { name: options.customerName } });
  }
  const enquiry = await makeEnquiry(customer.id, options.assignedToId);
  const status = options.status ?? "PENDING";
  const row = await db.followUp.create({
    data: {
      branchId: options.branchId,
      customerId: customer.id,
      enquiryId: enquiry.id,
      clientId: randomUUID(),
      dueDate: utcDay(options.due),
      timeSlot: options.slot ?? "EVENING",
      method: "CALL",
      assignedToId: options.assignedToId,
      createdFrom: "VISIT",
      status,
      notReachableCount: options.notReachableCount ?? 0,
      ...(status === "DONE"
        ? {
            result: "CALL_LATER",
            completedAt: noonOn(options.due),
            completedById: options.assignedToId,
          }
        : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
  return { ...row, customer };
}

async function sale(options: {
  salespersonId: string;
  branchId: string;
  day: string;
  cancelled?: boolean;
}) {
  const customer = await makeCustomer(options.branchId, options.salespersonId);
  const enquiry = await makeEnquiry(customer.id, options.salespersonId);
  return db.sale.create({
    data: {
      branchId: options.branchId,
      customerId: customer.id,
      enquiryId: enquiry.id,
      clientId: randomUUID(),
      billNumber: `B-${randomUUID().slice(0, 8)}`,
      billDate: utcDay(options.day),
      salespersonId: options.salespersonId,
      cancelled: options.cancelled ?? false,
    },
  });
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

beforeEach(async () => {
  store = await makeStore();
});

describe("loadToday (M11)", () => {
  it("moves one follow-up from Coming up to Today to Overdue as the days pass", async () => {
    const salesA = session(store.salesA);
    const row = await followUp({
      due: D,
      assignedToId: store.salesA.id,
      branchId: store.branchA.id,
    });

    const where = async (day: string) => {
      const data = await loadToday(salesA, noonOn(day));
      if (ids(data.overdue).includes(row.id)) return "overdue";
      if (ids(data.dueToday).includes(row.id)) return "today";
      if (ids(data.comingUp).includes(row.id)) return "comingUp";
      return "nowhere";
    };

    expect(await where(addDays(D, -8))).toBe("nowhere"); // beyond the next 7 days
    expect(await where(addDays(D, -7))).toBe("comingUp");
    expect(await where(addDays(D, -1))).toBe("comingUp");
    expect(await where(D)).toBe("today");
    expect(await where(addDays(D, 1))).toBe("overdue");
    expect(await where(addDays(D, 2))).toBe("overdue");

    // The counts agree with the lists.
    const onTheDay = await loadToday(salesA, noonOn(D));
    expect(onTheDay.counts).toMatchObject({ dueToday: 1, overdue: 0 });
    const later = await loadToday(salesA, noonOn(addDays(D, 2)));
    expect(later.counts).toMatchObject({ dueToday: 0, overdue: 1 });

    // BR-09: overdue until updated — once Done it leaves the screen.
    await db.followUp.update({ where: { id: row.id }, data: { status: "DONE" } });
    expect(await where(addDays(D, 2))).toBe("nowhere");
  });

  it("turns the day at midnight IST, not midnight UTC", async () => {
    const salesA = session(store.salesA);
    const row = await followUp({
      due: D,
      assignedToId: store.salesA.id,
      branchId: store.branchA.id,
    });
    const dayBefore = addDays(D, -1);

    const lastMinute = await loadToday(salesA, new Date(`${dayBefore}T18:29:00.000Z`)); // 23:59 IST
    expect(ids(lastMinute.comingUp)).toContain(row.id);
    const midnight = await loadToday(salesA, new Date(`${dayBefore}T18:30:00.000Z`)); // 00:00 IST
    expect(ids(midnight.dueToday)).toContain(row.id);
  });

  it("sorts today by Morning → Afternoon → Evening, then by when they were set", async () => {
    const salesA = session(store.salesA);
    const base = { due: D, assignedToId: store.salesA.id, branchId: store.branchA.id };
    const evening = await followUp({
      ...base,
      slot: "EVENING",
      createdAt: new Date("2031-03-01T01:00:00Z"),
    });
    const lateMorning = await followUp({
      ...base,
      slot: "MORNING",
      createdAt: new Date("2031-03-05T01:00:00Z"),
    });
    const afternoon = await followUp({
      ...base,
      slot: "AFTERNOON",
      createdAt: new Date("2031-03-02T01:00:00Z"),
    });
    const earlyMorning = await followUp({
      ...base,
      slot: "MORNING",
      createdAt: new Date("2031-03-03T01:00:00Z"),
    });

    const data = await loadToday(salesA, noonOn(D));
    expect(ids(data.dueToday)).toEqual([earlyMorning.id, lateMorning.id, afternoon.id, evening.id]);
  });

  it("lists overdue oldest first", async () => {
    const salesA = session(store.salesA);
    const base = { assignedToId: store.salesA.id, branchId: store.branchA.id };
    const twoDays = await followUp({ ...base, due: addDays(D, -2) });
    const fiveDays = await followUp({ ...base, due: addDays(D, -5) });

    const data = await loadToday(salesA, noonOn(D));
    expect(ids(data.overdue)).toEqual([fiveDays.id, twoDays.id]);
  });

  it("shows a salesperson only their own follow-ups, in every branch", async () => {
    const salesA = session(store.salesA);
    const mineHere = await followUp({
      due: D,
      assignedToId: store.salesA.id,
      branchId: store.branchA.id,
    });
    // A visit in the other branch files the follow-up there; it is still salesA's (BR-16).
    const mineThere = await followUp({
      due: D,
      assignedToId: store.salesA.id,
      branchId: store.branchB.id,
    });
    const salesBs = await followUp({
      due: D,
      assignedToId: store.salesB.id,
      branchId: store.branchA.id,
    });

    const data = await loadToday(salesA, noonOn(D));
    expect(ids(data.dueToday).sort()).toEqual([mineHere.id, mineThere.id].sort());
    expect(ids(data.dueToday)).not.toContain(salesBs.id);

    const other = await loadToday(session(store.salesB), noonOn(D));
    expect(ids(other.dueToday)).toEqual([salesBs.id]);
  });

  it("counts today's own sales, not cancelled ones, other days or other people's", async () => {
    const salesA = session(store.salesA);
    await sale({ salespersonId: store.salesA.id, branchId: store.branchA.id, day: D });
    await sale({ salespersonId: store.salesA.id, branchId: store.branchB.id, day: D });
    await sale({
      salespersonId: store.salesA.id,
      branchId: store.branchA.id,
      day: D,
      cancelled: true,
    });
    await sale({ salespersonId: store.salesA.id, branchId: store.branchA.id, day: addDays(D, -1) });
    await sale({ salespersonId: store.salesB.id, branchId: store.branchA.id, day: D });

    const data = await loadToday(salesA, noonOn(D));
    expect(data.counts.salesToday).toBe(2);
  });
});

describe("listFollowUps (M11)", () => {
  async function fiveOfSalesA() {
    const base = { assignedToId: store.salesA.id, branchId: store.branchA.id };
    return {
      future: await followUp({ ...base, due: addDays(D, 3) }),
      today: await followUp({ ...base, due: D }),
      overdue: await followUp({ ...base, due: addDays(D, -2) }),
      done: await followUp({ ...base, due: addDays(D, -1), status: "DONE" }),
      cancelled: await followUp({ ...base, due: addDays(D, 1), status: "CANCELLED" }),
    };
  }

  const list = (
    user: SessionUser,
    params: Record<string, string>,
    scope = branchScope(user, undefined),
  ) => listFollowUps(user, scope, parseListFilters(params), noonOn(D));

  const count = (
    user: SessionUser,
    params: Record<string, string>,
    scope = branchScope(user, undefined),
  ) => countFollowUps(user, scope, parseListFilters(params), noonOn(D));

  it("counts every tab under the same filters, so a search shows where the match is", async () => {
    const salesA = session(store.salesA);
    const rows = await fiveOfSalesA();

    expect(await count(salesA, {})).toEqual({ pending: 2, overdue: 1, done: 1, all: 5 });
    // Searching from the Pending tab for an overdue customer: Pending finds none, the
    // Overdue count says where they are.
    const q = rows.overdue.customer.name;
    expect(await count(salesA, { q })).toEqual({ pending: 0, overdue: 1, done: 0, all: 1 });
    expect(ids((await list(salesA, { q })).rows)).toEqual([]);

    const managerA = session(store.managerA);
    await followUp({ due: D, assignedToId: store.salesB.id, branchId: store.branchB.id });
    expect((await count(managerA, {})).all).toBe(5);
    expect((await count(managerA, { assignedTo: store.salesB.id })).all).toBe(0);
    expect((await count(session(store.managerB), {})).all).toBe(1);
  });

  it("splits the tabs without overlap: Pending, Overdue, Done, All", async () => {
    const salesA = session(store.salesA);
    const rows = await fiveOfSalesA();

    expect(ids((await list(salesA, {})).rows)).toEqual([rows.today.id, rows.future.id]);
    expect(ids((await list(salesA, { tab: "overdue" })).rows)).toEqual([rows.overdue.id]);
    expect(ids((await list(salesA, { tab: "done" })).rows)).toEqual([rows.done.id]);
    expect(ids((await list(salesA, { tab: "all" })).rows).sort()).toEqual(
      ids(Object.values(rows)).sort(),
    );
  });

  it("filters by due-date range", async () => {
    const salesA = session(store.salesA);
    const rows = await fiveOfSalesA();

    const { rows: found } = await list(salesA, {
      tab: "all",
      from: addDays(D, -1),
      to: addDays(D, 1),
    });
    expect(ids(found).sort()).toEqual([rows.today.id, rows.done.id, rows.cancelled.id].sort());
  });

  it("searches by name and by mobile, however the number is typed", async () => {
    const salesA = session(store.salesA);
    const base = { assignedToId: store.salesA.id, branchId: store.branchA.id, due: D };
    const rekha = await followUp({ ...base, customerName: "Rekha Joshi" });
    const other = await followUp({ ...base, customerName: "Suresh Mehta" });

    expect(ids((await list(salesA, { q: "rekha" })).rows)).toEqual([rekha.id]);
    const typed = formatMobile(other.customer.mobile as string); // "98765 43210"
    expect(ids((await list(salesA, { q: typed })).rows)).toEqual([other.id]);
    expect(ids((await list(salesA, { q: `+91 ${typed}` })).rows)).toEqual([other.id]);
  });

  it("keeps a salesperson to their own, whatever assignedTo says", async () => {
    const salesA = session(store.salesA);
    const mine = await followUp({
      due: D,
      assignedToId: store.salesA.id,
      branchId: store.branchA.id,
    });
    await followUp({ due: D, assignedToId: store.salesB.id, branchId: store.branchA.id });

    const { rows } = await list(salesA, { assignedTo: store.salesB.id });
    expect(ids(rows)).toEqual([mine.id]);
  });

  it("shows a manager their branch only, and narrows to one salesperson", async () => {
    const managerA = session(store.managerA);
    const inA = await followUp({
      due: D,
      assignedToId: store.salesA.id,
      branchId: store.branchA.id,
    });
    const inB = await followUp({
      due: D,
      assignedToId: store.salesB.id,
      branchId: store.branchB.id,
    });
    // salesB's customer seen in branch A belongs to branch A's list (BR-16).
    const salesBInA = await followUp({
      due: D,
      assignedToId: store.salesB.id,
      branchId: store.branchA.id,
    });

    const all = ids((await list(managerA, {})).rows);
    expect(all.sort()).toEqual([inA.id, salesBInA.id].sort());
    expect(all).not.toContain(inB.id);

    expect(ids((await list(managerA, { assignedTo: store.salesA.id })).rows)).toEqual([inA.id]);
    expect(ids((await list(managerA, { assignedTo: store.salesB.id })).rows)).toEqual([
      salesBInA.id,
    ]);

    const managerB = session(store.managerB);
    expect(ids((await list(managerB, {})).rows)).toEqual([inB.id]);
  });

  it("gives an admin every branch on All branches, and one on a single branch", async () => {
    const admin = session(store.admin);
    const inA = await followUp({
      due: D,
      assignedToId: store.salesA.id,
      branchId: store.branchA.id,
    });
    const inB = await followUp({
      due: D,
      assignedToId: store.salesB.id,
      branchId: store.branchB.id,
    });

    const everywhere = branchScope(admin, ALL_BRANCHES);
    expect(ids((await list(admin, { assignedTo: store.salesB.id }, everywhere)).rows)).toEqual([
      inB.id,
    ]);
    expect(ids((await list(admin, { assignedTo: store.salesA.id }, everywhere)).rows)).toEqual([
      inA.id,
    ]);

    const onlyA = branchScope(admin, store.branchA.id);
    expect(ids((await list(admin, { assignedTo: store.salesB.id }, onlyA)).rows)).toEqual([]);
  });

  it("pages 50 at a time and says when there is more", async () => {
    const salesA = session(store.salesA);
    for (let i = 0; i < LIST_PAGE + 1; i += 1) {
      await followUp({ due: D, assignedToId: store.salesA.id, branchId: store.branchA.id });
    }

    const first = await list(salesA, {});
    expect(first.rows).toHaveLength(LIST_PAGE);
    expect(first.hasMore).toBe(true);

    const more = await list(salesA, { limit: String(LIST_PAGE * 2) });
    expect(more.rows).toHaveLength(LIST_PAGE + 1);
    expect(more.hasMore).toBe(false);
  });
});
