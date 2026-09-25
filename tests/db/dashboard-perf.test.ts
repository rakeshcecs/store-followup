import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { db } = await import("@/lib/db");
const { loadAlerts, loadOverview } = await import("@/lib/dashboard");
const { addDays } = await import("@/lib/follow-up-dates");
const { makeBranch, makeUser } = await import("../helpers/branch-access");
const { REPORTS } = await import("@/lib/reports/definitions");
const { parseFilters, mainTable, sortRows } = await import("@/lib/reports/core");
const { toXlsx } = await import("@/lib/reports/xlsx");

// M12 "Done when": the page loads in under 3 seconds with 12 months of data. A busy
// branch's year, written in bulk: 6 salespeople, 3,000 customers, 30,000 visits, 12,000
// follow-ups and 4,000 sales, then the overview for the whole year and the alerts.
const TODAY = "2034-06-30";
const DAYS = 365;
const BUDGET_MS = 3_000;
let branchId: string;

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const pick = <T>(list: T[], i: number) => list[i % list.length]!;

async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 2_000) await write(rows.slice(i, i + 2_000));
}

beforeAll(async () => {
  branchId = (await makeBranch()).id;
  const people = await Promise.all(
    Array.from({ length: 6 }, () => makeUser({ role: "SALESPERSON", homeBranchId: branchId })),
  );
  const staff = people.map((person) => person.id);

  const customers = Array.from({ length: 3_000 }, (_, i) => ({
    id: randomUUID(),
    name: `Perf ${i}`,
    mobile: `8${String(i).padStart(4, "0")}${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`,
    assignedToId: pick(staff, i),
    homeBranchId: branchId,
  }));
  await inChunks(customers, (data) => db.customer.createMany({ data }));
  const enquiries = customers.map((c) => ({
    id: randomUUID(),
    customerId: c.id,
    assignedToId: c.assignedToId,
    title: "Wedding",
  }));
  await inChunks(enquiries, (data) => db.enquiry.createMany({ data }));

  const day = (i: number) => addDays(TODAY, -(i % DAYS));
  await inChunks(
    Array.from({ length: 30_000 }, (_, i) => ({
      branchId,
      customerId: pick(customers, i).id,
      enquiryId: pick(enquiries, i).id,
      clientId: randomUUID(),
      visitAt: new Date(`${day(i)}T10:00:00.000+05:30`),
      salespersonId: pick(staff, i),
      outcome: i % 10 === 0 ? ("NOT_INTERESTED" as const) : ("DECIDE_LATER" as const),
      visitType: i % 3 === 0 ? ("NEW" as const) : ("EXISTING" as const),
    })),
    (data) => db.visit.createMany({ data }),
  );
  // Done follow-ups across the year, and at most one pending per customer (BR-02).
  await inChunks(
    Array.from({ length: 12_000 }, (_, i) => {
      const pending = i < 1_500;
      return {
        branchId,
        customerId: pick(customers, i).id,
        enquiryId: pick(enquiries, i).id,
        clientId: randomUUID(),
        dueDate: utc(day(i * 7)),
        timeSlot: "EVENING" as const,
        method: "CALL" as const,
        assignedToId: pick(staff, i),
        createdFrom: "VISIT" as const,
        status: pending ? ("PENDING" as const) : ("DONE" as const),
        completedAt: pending ? null : new Date(`${day(i * 7)}T12:00:00.000+05:30`),
        notReachableCount: i % 50 === 0 ? 3 : 0,
      };
    }),
    (data) => db.followUp.createMany({ data }),
  );
  await inChunks(
    Array.from({ length: 4_000 }, (_, i) => ({
      branchId,
      customerId: pick(customers, i).id,
      enquiryId: pick(enquiries, i).id,
      clientId: randomUUID(),
      billNumber: `P-${randomUUID().slice(0, 12)}`,
      billDate: utc(day(i * 3)),
      salespersonId: pick(staff, i),
      fromFollowUp: i % 2 === 0,
    })),
    (data) => db.sale.createMany({ data }),
  );
}, 180_000);

afterAll(() => db.$disconnect());

describe("Store overview with 12 months of data", () => {
  it(`loads the whole year and the alerts in under ${BUDGET_MS / 1000} seconds`, async () => {
    const scope = { all: false as const, branchIds: [branchId] };
    const range = { from: addDays(TODAY, -(DAYS - 1)), to: TODAY };

    const started = performance.now();
    const [overview, alerts] = await Promise.all([
      loadOverview(scope, range, TODAY, "en"),
      loadAlerts(scope, TODAY),
    ]);
    const took = performance.now() - started;

    expect(overview.people).toHaveLength(6);
    expect(overview.sales.total).toBe(4_000);
    expect(overview.visited.total).toBe(3_000);
    expect(alerts.notReachable.count).toBeGreaterThan(0);
    process.stderr.write(`M12 overview, 12 months: ${Math.round(took)} ms\n`);
    expect(took).toBeLessThan(BUDGET_MS);
  });

  // M13.04: every report within 5 seconds for 12 months — running, sorting the whole
  // table and, for the biggest (R1, 30,000 visits), writing the Excel file too.
  it("runs every report for the year in under 5 seconds each", async () => {
    const ctx = {
      scope: { all: false as const, branchIds: [branchId] },
      range: { from: addDays(TODAY, -(DAYS - 1)), to: TODAY },
      today: TODAY,
      filters: parseFilters({}),
      self: null,
      locale: "en" as const,
    };
    for (const code of ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r9"] as const) {
      const started = performance.now();
      const result = await REPORTS[code].run(ctx);
      const table = mainTable(result)!;
      sortRows(table.rows, REPORTS[code].defaultSort.key, "desc", "en");
      if (code === "r1")
        await toXlsx({ storeName: "S", title: "R1", lines: [], exportedAt: "" }, result);
      const took = performance.now() - started;
      const line = `M13 ${code}, 12 months: ${table.rows.length} rows, ${Math.round(took)} ms`;
      process.stderr.write(`${line}\n`);
      expect(took, code).toBeLessThan(5_000);
    }
  }, 120_000);
});
