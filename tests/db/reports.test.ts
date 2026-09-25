import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  FollowUpResult,
  FollowUpStatus,
  VisitOutcome,
  VisitType,
} from "@/generated/prisma/client";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));

const { db } = await import("@/lib/db");
const { loadOverview } = await import("@/lib/dashboard");
const { addDays } = await import("@/lib/follow-up-dates");
const { REPORTS } = await import("@/lib/reports/definitions");
const { parseFilters, mainTable } = await import("@/lib/reports/core");
const { runReport } = await import("@/lib/reports/run");
const { toXlsx } = await import("@/lib/reports/xlsx");
const { toPdf } = await import("@/lib/reports/pdf");
const { requireUser } = await import("@/lib/auth");
const { reassignDetail, TIMELINE } = await import("@/lib/timeline");
const { makeStore } = await import("../helpers/store");
const { signInAs } = await import("../helpers/session");
type RunContext = import("@/lib/reports/core").RunContext;
type ReportResult = import("@/lib/reports/core").ReportResult;

// M13 "Done when": every report matches hand-counted totals. One fixed day, far from
// every other file's data; two branches, two managers, two salespeople and an admin.
const D = "2035-05-16";
let store: Awaited<ReturnType<typeof makeStore>>;
let saree: string;
const ids: Record<string, string> = {};
const mobiles: Record<string, string> = {};

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const ist = (day: string, time = "11:00") => new Date(`${day}T${time}:00.000+05:30`);

async function customer(key: string, owner: string, branchId: string) {
  const mobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const c = await db.customer.create({
    data: { name: `Rep ${key}`, mobile, assignedToId: owner, homeBranchId: branchId },
  });
  const e = await db.enquiry.create({
    data: { customerId: c.id, assignedToId: owner, title: `Need ${key}` },
  });
  ids[key] = c.id;
  ids[`${key}:enquiry`] = e.id;
  mobiles[key] = mobile;
  return { customerId: c.id, enquiryId: e.id };
}
const of = (key: string) => ({ customerId: ids[key]!, enquiryId: ids[`${key}:enquiry`]! });

async function visit(
  key: string,
  who: string,
  branchId: string,
  at: Date,
  type: VisitType,
  outcome: VisitOutcome = "DECIDE_LATER",
  extra: { lostReasonId?: string; remarks?: string } = {},
) {
  await db.visit.create({
    data: {
      ...of(key),
      branchId,
      clientId: randomUUID(),
      visitAt: at,
      salespersonId: who,
      visitType: type,
      outcome,
      ...extra,
    },
  });
}

async function followUp(
  key: string,
  who: string,
  branchId: string,
  due: string,
  status: FollowUpStatus = "PENDING",
  extra: { result?: FollowUpResult; resultNote?: string } = {},
) {
  const f = await db.followUp.create({
    data: {
      ...of(key),
      branchId,
      clientId: randomUUID(),
      dueDate: utc(due),
      timeSlot: "EVENING",
      method: "CALL",
      assignedToId: who,
      createdFrom: "VISIT",
      status,
      ...extra,
      ...(status === "DONE" ? { completedAt: ist(due, "12:00"), completedById: who } : {}),
    },
  });
  return f.id;
}

async function sale(
  key: string,
  who: string,
  branchId: string,
  amount: number,
  fromFollowUp: boolean,
  cancelled = false,
) {
  await db.sale.create({
    data: {
      ...of(key),
      branchId,
      clientId: randomUUID(),
      billNumber: `REP-${randomUUID().slice(0, 8)}`,
      billDate: utc(D),
      billAmount: amount,
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
  const mA = store.managerA.id;
  const sB = store.salesB.id;
  saree = (await db.department.create({ data: { name: `Sarees ${randomUUID().slice(0, 4)}` } })).id;
  await db.user.update({ where: { id: sA }, data: { departmentId: saree } });
  const reason = (nameEn: string) =>
    db.lostReason.create({ data: { nameEn, nameHi: `${nameEn} हि`, nameGu: `${nameEn} ગુ` } });
  const price = await reason(`Price ${randomUUID().slice(0, 4)}`);
  const elsewhere = await reason(`Elsewhere ${randomUUID().slice(0, 4)}`);
  ids.price = price.id;

  for (const key of ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11"]) {
    await customer(key, sA, a);
  }
  await customer("b1", sB, b);
  await customer("b2", sA, b); // salesA's follow-up filed in branch B (M08.08)

  // Visits in A on D: c1 NEW (sA), c2 bought (sA), c3 not interested (sA), c1 again by
  // the manager. D-1: c4 NEW. D-10: c2's first visit. B on D: b1 NEW.
  await visit("c1", sA, a, ist(D), "NEW");
  await visit("c2", sA, a, ist(D), "EXISTING", "PURCHASED");
  await visit("c3", sA, a, ist(D), "EXISTING", "NOT_INTERESTED", {
    lostReasonId: price.id,
    remarks: "Too costly",
  });
  await visit("c1", mA, a, ist(D, "15:00"), "EXISTING");
  await visit("c4", sA, a, ist(addDays(D, -1)), "NEW");
  await visit("c2", sA, a, ist(addDays(D, -10)), "NEW");
  await visit("b1", sB, b, ist(D), "NEW");

  // Follow-ups: c2's two done calls before its sale; due on D: f1 pending, f2 done,
  // f3 cancelled, f5 done as not interested; f4 three days late; b2 salesA's in branch B.
  await followUp("c2", sA, a, addDays(D, -5), "DONE", { result: "WILL_VISIT" });
  await followUp("c2", sA, a, addDays(D, -4), "DONE", { result: "CALL_LATER" });
  ids.f1 = await followUp("c7", sA, a, D);
  ids.f2 = await followUp("c8", sA, a, D, "DONE", { result: "WILL_VISIT" });
  ids.f3 = await followUp("c9", sA, a, D, "CANCELLED");
  ids.f4 = await followUp("c10", sA, a, addDays(D, -3));
  ids.f5 = await followUp("c11", sA, a, D, "DONE", {
    result: "NOT_INTERESTED",
    resultNote: "Bought elsewhere",
  });
  await db.enquiry.update({
    where: { id: ids["c11:enquiry"] },
    data: { status: "NOT_INTERESTED", lostReasonId: elsewhere.id, closedAt: ist(D, "12:00") },
  });
  ids.fb2 = await followUp("b2", sA, b, D);

  // Sales on D: c2 from follow-ups ₹5,000; c5 ₹3,000; c6 cancelled ₹1,000; B: b1 ₹2,000.
  await sale("c2", sA, a, 5000, true);
  await sale("c5", sA, a, 3000, false);
  await sale("c6", sA, a, 1000, false, true);
  await sale("b1", sB, b, 2000, false);

  // Two history rows for R8.
  await db.timelineEvent.create({
    data: {
      customerId: ids.c2!,
      staffId: sA,
      type: TIMELINE.visit.type,
      title: TIMELINE.visit.title,
      detail: "Liked the red one",
      branchId: a,
      createdAt: ist(addDays(D, -10)),
    },
  });
  await db.timelineEvent.create({
    data: {
      customerId: ids.c2!,
      staffId: mA,
      type: TIMELINE.reassigned.type,
      title: TIMELINE.reassigned.title,
      detail: reassignDetail("Amit", "Priya"),
      createdAt: ist(D),
    },
  });
});

afterAll(() => db.$disconnect());

function ctx(extra: Partial<RunContext> & { params?: Record<string, string> } = {}): RunContext {
  const { params, ...rest } = extra;
  return {
    scope: { all: false, branchIds: [store.branchA.id] },
    range: { from: D, to: D },
    today: D,
    filters: parseFilters(params ?? {}),
    self: null,
    locale: "en",
    ...rest,
  };
}
const table = (result: ReportResult) => mainTable(result)!;
const count = async (code: keyof typeof REPORTS, c: RunContext) =>
  table(await REPORTS[code].run(c)).rows.length;

describe("R1 Customer visits", () => {
  it("lists every visit of the day in the branch, and counts customers once", async () => {
    const t = table(await REPORTS.r1.run(ctx()));
    expect(t.rows).toHaveLength(4);
    expect(t.totals?.customer).toBe("4 visits, 3 customers");
  });

  it("filters by salesperson, department, new/existing and outcome", async () => {
    expect(await count("r1", ctx({ params: { salesperson: store.salesA.id } }))).toBe(3);
    expect(await count("r1", ctx({ params: { department: saree } }))).toBe(3);
    expect(await count("r1", ctx({ params: { visitType: "NEW" } }))).toBe(1);
    expect(await count("r1", ctx({ params: { outcome: "NOT_INTERESTED" } }))).toBe(1);
  });

  it("branch B sees only its own visit", async () => {
    expect(await count("r1", ctx({ scope: { all: false, branchIds: [store.branchB.id] } }))).toBe(
      1,
    );
  });
});

describe("R2 Salesperson summary", () => {
  it("per person and in total, the dashboard's numbers", async () => {
    const t = table(await REPORTS.r2.run(ctx()));
    const sA = t.rows.find((row) => row.cells.salesperson === store.salesA.fullName)!.cells;
    expect(sA).toMatchObject({
      visits: 3,
      newCustomers: 1,
      due: 3, // f1, f2, f5
      done: 2,
      overdue: 1, // f4
      sales: 2,
      conversions: 1,
      conversionPercent: 25, // 1 ÷ (2 sales + 2 not interested)
    });
    expect(t.totals).toMatchObject({
      visits: 4,
      due: 3,
      done: 2,
      overdue: 1,
      sales: 2,
      conversions: 1,
    });

    const overview = await loadOverview(ctx().scope, ctx().range, D, "en");
    expect(t.totals?.due).toBe(overview.due.total);
    expect(t.totals?.done).toBe(overview.due.done);
    expect(t.totals?.overdue).toBe(overview.overdue);
    expect(t.totals?.sales).toBe(overview.sales.total);
    expect(t.totals?.conversions).toBe(overview.sales.fromFollowUps);
    expect(t.totals?.conversionPercent).toBe(overview.conversionPercent);
  });

  it("department and a salesperson's own view show one row", async () => {
    expect(await count("r2", ctx({ params: { department: saree } }))).toBe(1);
    const own = table(await REPORTS.r2.run(ctx({ self: store.salesA.id })));
    expect(own.rows.map((row) => row.cells.salesperson)).toEqual([store.salesA.fullName]);
  });
});

describe("R3 Follow-ups", () => {
  it("due in the period, with each status", async () => {
    expect(await count("r3", ctx())).toBe(4); // f1, f2, f3, f5
    expect(await count("r3", ctx({ params: { status: "pending" } }))).toBe(1);
    expect(await count("r3", ctx({ params: { status: "done" } }))).toBe(2);
    expect(await count("r3", ctx({ params: { status: "cancelled" } }))).toBe(1);
    const wider = ctx({ range: { from: addDays(D, -5), to: D } });
    expect(await count("r3", wider)).toBe(7); // + f4 and c2's two
    const late = table(
      await REPORTS.r3.run({ ...wider, filters: parseFilters({ status: "overdue" }) }),
    );
    expect(late.rows).toHaveLength(1);
    expect(late.rows[0]!.cells.status).toBe("Overdue");
  });

  it("a salesperson's own list includes theirs filed in the other branch", async () => {
    const own = await count("r3", ctx({ self: store.salesA.id }));
    expect(own).toBe(5); // the four in A + b2 in B
  });
});

describe("R4 Follow-up conversion", () => {
  it("the sale from follow-ups, with its calls, first visit and days", async () => {
    const t = table(await REPORTS.r4.run(ctx()));
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]!.cells).toMatchObject({
      customer: "Rep c2",
      followUps: 2,
      firstVisit: addDays(D, -10),
      saleDate: D,
      daysToConvert: 10,
    });
  });
});

describe("R5 Sales and bill numbers", () => {
  it("adds up the sales that count; cancelled ones only listed when asked", async () => {
    const t = table(await REPORTS.r5.run(ctx()));
    expect(t.rows).toHaveLength(2);
    expect(t.totals?.amount).toBe(8000);
    expect(t.totals?.customer).toBe("2 sales, 1 from follow-ups");
    const all = table(await REPORTS.r5.run(ctx({ params: { cancelled: "yes" } })));
    expect(all.rows).toHaveLength(3);
    expect(all.totals?.amount).toBe(8000);
    expect(await count("r5", ctx({ params: { fromFollowUp: "yes" } }))).toBe(1);
    expect(await count("r5", ctx({ params: { fromFollowUp: "no" } }))).toBe(1);
  });
});

describe("R6 New vs existing", () => {
  it("day by day, every day of the range, with totals", async () => {
    const result = await REPORTS.r6.run(ctx({ range: { from: addDays(D, -1), to: D } }));
    const t = table(result);
    expect(t.rows.map((row) => row.cells)).toEqual([
      { date: addDays(D, -1), new: 1, existing: 0, total: 1 },
      { date: D, new: 1, existing: 2, total: 3 },
    ]);
    expect(t.totals).toMatchObject({ new: 2, existing: 2, total: 4 });
    expect(result.chart).toHaveLength(2);
  });
});

describe("R7 Not-interested reasons", () => {
  it("a visit and a call, summed by reason", async () => {
    const result = await REPORTS.r7.run(ctx());
    const [summary, detail] = result.tables;
    expect(detail!.rows).toHaveLength(2);
    expect(summary!.rows.map((row) => row.cells.count)).toEqual([1, 1]);
    expect(summary!.rows.map((row) => row.cells.share)).toEqual([50, 50]);
    expect(summary!.totals).toMatchObject({ count: 2, share: 100 });
    expect(detail!.rows.map((row) => row.cells.remarks).sort()).toEqual([
      "Bought elsewhere",
      "Too costly",
    ]);
    const onlyPrice = await REPORTS.r7.run(ctx({ params: { reason: ids.price! } }));
    expect(table(onlyPrice).rows).toHaveLength(1);
    // The dashboard's tile says the same.
    const overview = await loadOverview(ctx().scope, ctx().range, D, "en");
    expect(overview.notInterested.total).toBe(2);
  });
});

describe("R8 Customer history", () => {
  it("finds the customer by mobile, any way it is typed", async () => {
    const typed = `+91 ${mobiles.c2!.slice(0, 5)} ${mobiles.c2!.slice(5)}`;
    const result = await REPORTS.r8.run(ctx({ params: { mobile: typed } }));
    const t = table(result);
    expect(t.title).toBe("Rep c2");
    expect(t.rows.map((row) => row.cells.event)).toEqual([
      "Reassigned from Amit to Priya",
      "Visit",
    ]);
  });

  it("says so for an unknown number", async () => {
    const result = await REPORTS.r8.run(ctx({ params: { mobile: "9000000001" } }));
    expect(result.tables).toHaveLength(0);
    expect(result.empty).toBe("No customer with this mobile number.");
  });
});

describe("R9 Branch comparison", () => {
  it("one row per branch and a store total", async () => {
    const t = table(
      await REPORTS.r9.run(
        ctx({ scope: { all: false, branchIds: [store.branchA.id, store.branchB.id] } }),
      ),
    );
    const row = (id: string) =>
      t.rows.find((r) => r.cells.branch === (id === "A" ? store.branchA.name : store.branchB.name))!
        .cells;
    expect(row("A")).toMatchObject({
      visits: 4,
      newCustomers: 1,
      done: 2,
      overdue: 1,
      sales: 2,
      conversionPercent: 25,
    });
    expect(row("B")).toMatchObject({
      visits: 1,
      newCustomers: 1,
      done: 0,
      overdue: 0, // b2 is due today, not late
      sales: 1,
      conversionPercent: 0,
    });
    expect(t.totals).toMatchObject({
      visits: 5,
      newCustomers: 2,
      done: 2,
      overdue: 1,
      sales: 3,
      conversionPercent: 20,
    });
  });
});

describe("who may open what (M13.03)", () => {
  const as = async (mobile: string) => {
    await signInAs(mobile);
    return requireUser();
  };

  it("a salesperson: R2 and R3 for themselves only, nothing else", async () => {
    const user = await as(store.salesA.mobile);
    expect(await runReport(user, "r1", {}, "en")).toBeNull();
    expect(await runReport(user, "r9", {}, "en")).toBeNull();
    const r2 = await runReport(user, "r2", { from: D, to: D, salesperson: store.salesB.id }, "en");
    expect(r2?.ctx.self).toBe(store.salesA.id);
    expect(table(r2!.result).rows.map((row) => row.cells.salesperson)).toEqual([
      store.salesA.fullName,
    ]);
  });

  it("a manager: R1–R8 but not R9; an admin: all", async () => {
    const manager = await as(store.managerA.mobile);
    expect(await runReport(manager, "r1", {}, "en")).not.toBeNull();
    expect(await runReport(manager, "r9", {}, "en")).toBeNull();
    const admin = await as(store.admin.mobile);
    expect(await runReport(admin, "r9", {}, "en")).not.toBeNull();
    expect(await runReport(admin, "r12", {}, "en")).toBeNull();
  });

  it("the column to sort by must be one of the report's", async () => {
    const manager = await as(store.managerA.mobile);
    const byAmount = await runReport(
      manager,
      "r5",
      { from: D, to: D, sort: "amount", dir: "desc" },
      "en",
    );
    expect(table(byAmount!.result).rows.map((row) => row.cells.amount)).toEqual([5000, 3000]);
    const bogus = await runReport(manager, "r5", { from: D, to: D, sort: "pinHash" }, "en");
    expect(bogus?.sort).toEqual(REPORTS.r5.defaultSort);
  });
});

describe("exports", () => {
  const meta = { storeName: "Test Store", title: "Sales", lines: ["Period: x"], exportedAt: "now" };

  it("Excel: real dates and numbers under the heading lines", async () => {
    const buffer = await toXlsx(meta, await REPORTS.r5.run(ctx()));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    );
    const sheet = book.worksheets[0]!;
    expect(sheet.getCell("A1").value).toBe("Test Store");
    // store, title, one filter line, exported at, a blank row, then the header.
    const header = sheet.getRow(6);
    expect(header.getCell(1).value).toBe("Bill date");
    const first = sheet.getRow(7);
    expect(first.getCell(1).value).toBeInstanceOf(Date);
    expect((first.getCell(1).value as Date).toISOString().slice(0, 10)).toBe(D);
    expect(typeof first.getCell(5).value).toBe("number");
    expect(first.getCell(5).numFmt).toBe("#,##0.00");
    // The totals row: "Total" in the date column stays text (it used to throw).
    const totals = sheet.getRow(9);
    expect(totals.getCell(1).value).toBe("Total");
    expect(totals.getCell(5).value).toBe(8000);
  });

  it("PDF: a real PDF, in Hindi too", async () => {
    const result = await REPORTS.r7.run(ctx({ locale: "hi" }));
    const pdf = await toPdf({ ...meta, title: "रुचि न होने के कारण" }, result, "hi");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
  });
});
