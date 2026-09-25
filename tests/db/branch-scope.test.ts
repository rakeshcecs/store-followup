import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { branchWhere, branchWhereShared, type BranchScope } from "@/lib/permissions";
import { makeTwoBranchFixture } from "../helpers/branch-access";

type Fixture = Awaited<ReturnType<typeof makeTwoBranchFixture>>;
let f: Fixture;

beforeAll(async () => {
  f = await makeTwoBranchFixture();
});

afterAll(() => db.$disconnect());

// The models where branchId is required. Each entry reads the same way a screen would.
function readers(scope: BranchScope) {
  const where = branchWhere(scope);
  return {
    visit: () => db.visit.findMany({ where, select: { id: true } }),
    followUp: () => db.followUp.findMany({ where, select: { id: true } }),
    sale: () => db.sale.findMany({ where, select: { id: true } }),
    importJob: () => db.importJob.findMany({ where, select: { id: true } }),
  };
}

describe("branchWhere on a manager's scope", () => {
  it("returns their own branch's records and none from the other branch", async () => {
    const scope: BranchScope = { all: false, branchIds: [f.branchA.id] };
    const models = readers(scope);

    for (const [model, read] of Object.entries(models)) {
      const ids = (await read()).map((row) => row.id);
      const mine = f.recordsA[model as keyof typeof f.recordsA].id;
      const theirs = f.recordsB[model as keyof typeof f.recordsB].id;

      expect(ids, `${model}: own branch`).toContain(mine);
      expect(ids, `${model}: other branch`).not.toContain(theirs);
    }
  });
});

describe("branchWhere on an admin's all-branches scope", () => {
  it("returns records from both branches", async () => {
    const models = readers({ all: true });

    for (const [model, read] of Object.entries(models)) {
      const ids = (await read()).map((row) => row.id);
      expect(ids, model).toContain(f.recordsA[model as keyof typeof f.recordsA].id);
      expect(ids, model).toContain(f.recordsB[model as keyof typeof f.recordsB].id);
    }
  });
});

describe("branchWhereShared", () => {
  it("returns the branch's rows plus the ones that belong to every branch", async () => {
    const day = new Date("2026-10-05");
    const [mine, everywhere, theirs] = await Promise.all([
      db.festival.create({ data: { name: "Branch A day", date: day, branchId: f.branchA.id } }),
      db.festival.create({ data: { name: "Everyone's day", date: day, branchId: null } }),
      db.festival.create({ data: { name: "Branch B day", date: day, branchId: f.branchB.id } }),
    ]);

    const ids = (
      await db.festival.findMany({
        where: branchWhereShared({ all: false, branchIds: [f.branchA.id] }),
        select: { id: true },
      })
    ).map((row) => row.id);

    expect(ids).toContain(mine.id);
    expect(ids).toContain(everywhere.id);
    expect(ids).not.toContain(theirs.id);
    await db.festival.deleteMany({ where: { id: { in: [mine.id, everywhere.id, theirs.id] } } });
  });
});

describe("a manager of one branch reading another branch's record by id", () => {
  it("finds nothing, so the screen shows NOT_FOUND rather than leaking it exists", async () => {
    const scope: BranchScope = { all: false, branchIds: [f.branchA.id] };

    const visit = await db.visit.findFirst({
      where: { id: f.recordsB.visit.id, ...branchWhere(scope) },
    });
    expect(visit).toBeNull();

    // The same id is readable for a manager who also covers branch B.
    const forBoth = await db.visit.findFirst({
      where: {
        id: f.recordsB.visit.id,
        ...branchWhere({ all: false, branchIds: [f.branchA.id, f.branchB.id] }),
      },
    });
    expect(forBoth?.id).toBe(f.recordsB.visit.id);
  });
});
