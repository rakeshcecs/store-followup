import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { loadAuditLog, parseAuditFilters } = await import("@/lib/audit-log");
const { addDays } = await import("@/lib/follow-up-dates");
const { makeBranch, makeUser } = await import("../helpers/branch-access");
type SessionUser = import("@/lib/auth").SessionUser;

// M16: the log is kept 3 years, so the screen must stay quick when it is full. 200,000
// rows over 3 years across two branches (~180 a day — a busy store), then the screens a
// manager and an admin open. SOW: screens and search under 2 seconds.
const TODAY = "2038-12-31";
const DAYS = 3 * 365;
const ROWS = 200_000;
const BUDGET_MS = 2_000;
const ENTITY = "PerfAudit"; // so the clean-up removes exactly these rows
const IST = (5 * 60 + 30) * 60 * 1000;

let manager: SessionUser;
let admin: SessionUser;
let branchA: string;
let needle: string; // one entity id to search for

const actions = [AUDIT.visitCreate, AUDIT.followUpResult, AUDIT.saleCreate, AUDIT.saleCancel];

beforeAll(async () => {
  branchA = (await makeBranch()).id;
  const branchB = (await makeBranch()).id;
  const m = await makeUser({ role: "MANAGER", homeBranchId: branchA });
  const a = await makeUser({ role: "ADMIN", homeBranchId: branchA });
  manager = { ...m, branchIds: [branchA], language: "en" } as SessionUser;
  admin = { ...a, branchIds: [branchA], language: "en" } as SessionUser;
  needle = randomUUID();

  const start = new Date(`${addDays(TODAY, -DAYS)}T00:00:00.000Z`).getTime() - IST;
  const step = (DAYS * 24 * 60 * 60 * 1000) / ROWS;
  const rows = Array.from({ length: ROWS }, (_, i) => ({
    userId: i % 2 ? m.id : a.id,
    branchId: i % 2 ? branchA : branchB,
    action: actions[i % actions.length]!,
    entityType: ENTITY,
    entityId: i === ROWS - 10 ? needle : randomUUID(),
    newValue: { status: "DONE", note: `row ${i}` },
    createdAt: new Date(start + i * step),
  }));
  for (let i = 0; i < rows.length; i += 5_000)
    await db.auditLog.createMany({ data: rows.slice(i, i + 5_000) });
}, 600_000);

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityType: ENTITY } });
  await db.$disconnect();
}, 120_000);

async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const began = performance.now();
  const result = await run();
  return { ms: performance.now() - began, result };
}

describe("audit log with 3 years of rows", () => {
  const last30 = (extra: Record<string, string> = {}) =>
    parseAuditFilters({ from: addDays(TODAY, -29), to: TODAY, ...extra }, TODAY);
  const allYears = (extra: Record<string, string> = {}) =>
    parseAuditFilters({ from: addDays(TODAY, -(DAYS - 1)), to: TODAY, ...extra }, TODAY);

  it("opens quickly for a manager and for an admin on All branches", async () => {
    const m = await timed(() =>
      loadAuditLog(manager, { all: false, branchIds: [branchA] }, last30()),
    );
    const a = await timed(() => loadAuditLog(admin, { all: true }, last30()));
    console.log(`audit: manager 30 days ${m.ms.toFixed(0)} ms, admin ${a.ms.toFixed(0)} ms`);
    expect(m.result.rows).toHaveLength(50);
    expect(a.result.total).toBeGreaterThan(m.result.total);
    expect(m.ms).toBeLessThan(BUDGET_MS);
    expect(a.ms).toBeLessThan(BUDGET_MS);
  });

  it("filters and pages through all three years quickly", async () => {
    const kind = await timed(() =>
      loadAuditLog(admin, { all: true }, allYears({ kind: "CANCEL" })),
    );
    const late = await timed(() => loadAuditLog(admin, { all: true }, allYears({ page: "1000" })));
    console.log(
      `audit: 3 years cancel filter ${kind.ms.toFixed(0)} ms (${kind.result.total} rows), page 1000 ${late.ms.toFixed(0)} ms`,
    );
    // The range starts a day after the first row, so a few of the first are outside it.
    expect(kind.result.total).toBeGreaterThan(ROWS / actions.length - 100);
    expect(kind.ms).toBeLessThan(BUDGET_MS);
    expect(late.ms).toBeLessThan(BUDGET_MS);
  });

  it("finds one record's rows across three years quickly", async () => {
    // Search resolves a mobile or bill to ids; the lookup by id is what must be quick.
    const found = await timed(() =>
      db.auditLog.findMany({
        where: {
          AND: [
            { createdAt: { gte: new Date(`${addDays(TODAY, -(DAYS - 1))}T00:00:00Z`) } },
            { entityId: { in: [needle] } },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      }),
    );
    console.log(`audit: search by id ${found.ms.toFixed(0)} ms`);
    expect(found.result).toHaveLength(1);
    expect(found.ms).toBeLessThan(BUDGET_MS);
  });
});
