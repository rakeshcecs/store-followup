import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The helper is imported lazily, inside cookies(): importing it in the factory would
// deadlock, because the helper reaches @/lib/session, which imports the very module
// this factory is still building.
vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createBranch, setBranchStatus, updateBranch } =
  await import("@/app/(admin)/branches/actions");
const { db } = await import("@/lib/db");
const { makeBranch, makeUser, nextMobile } = await import("../helpers/branch-access");
const { signInAs } = await import("../helpers/session");

const branchData = (name: string) => ({
  name,
  address: "12 MG Road",
  city: "Ahmedabad",
  phone: "079 1234 5678",
  gstNumber: "",
  openingHours: "",
});

let adminMobile: string;
let managerMobile: string;
let homeBranchId: string;

beforeAll(async () => {
  const branch = await makeBranch();
  homeBranchId = branch.id;
  adminMobile = nextMobile();
  managerMobile = nextMobile();
  await makeUser({ role: "ADMIN", homeBranchId, mobile: adminMobile });
  await makeUser({ role: "MANAGER", homeBranchId, mobile: managerMobile });
});

afterAll(() => db.$disconnect());

function audit(entityId: string) {
  return db.auditLog.findMany({ where: { entityType: "Branch", entityId } });
}

describe("createBranch", () => {
  it("saves the branch and records who created it", async () => {
    await signInAs(adminMobile);
    const name = `Created ${Date.now()}`;

    const result = await createBranch(branchData(name));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const saved = await db.branch.findUnique({ where: { id: result.data.id } });
    expect(saved).toMatchObject({ name, city: "Ahmedabad", status: "ACTIVE" });
    expect(saved?.createdById).toBeTruthy();

    const entries = await audit(result.data.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "branch:create", device: "vitest" });
  });

  it("stores the GST number in upper case", async () => {
    await signInAs(adminMobile);
    const result = await createBranch({
      ...branchData(`Gst ${Date.now()}`),
      gstNumber: "24aaapl1234c1zv",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const saved = await db.branch.findUnique({ where: { id: result.data.id } });
    expect(saved?.gstNumber).toBe("24AAAPL1234C1ZV");
  });

  it("puts a duplicate name on the name field instead of the whole form", async () => {
    await signInAs(adminMobile);
    const name = `Duplicate ${Date.now()}`;

    expect((await createBranch(branchData(name))).ok).toBe(true);
    const second = await createBranch(branchData(name));

    expect(second).toMatchObject({
      ok: false,
      code: "CONFLICT",
      field: "name",
      message: "branches.errors.nameTaken",
    });
  });
});

describe("updateBranch", () => {
  it("saves the change and records what it was before", async () => {
    await signInAs(adminMobile);
    const branch = await makeBranch(`Before ${Date.now()}`);
    const name = `After ${Date.now()}`;

    const result = await updateBranch({ ...branchData(name), id: branch.id });
    expect(result.ok).toBe(true);

    const saved = await db.branch.findUnique({ where: { id: branch.id } });
    expect(saved?.name).toBe(name);

    const entry = (await audit(branch.id)).find((row) => row.action === "branch:update");
    expect(entry?.oldValue).toMatchObject({ name: branch.name });
    expect(entry?.newValue).toMatchObject({ name });
  });

  it("reports a branch that is not there", async () => {
    await signInAs(adminMobile);
    const result = await updateBranch({ ...branchData("Ghost"), id: "no-such-branch" });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("setBranchStatus", () => {
  it("refuses while someone still works at the branch", async () => {
    await signInAs(adminMobile);
    const branch = await makeBranch();
    await makeUser({ role: "SALESPERSON", homeBranchId: branch.id });

    const result = await setBranchStatus({ id: branch.id, status: "INACTIVE" });
    expect(result).toMatchObject({
      ok: false,
      code: "RULE",
      message: "branches.errors.staffPresent",
    });
  });

  it("also refuses when only a manager from another branch covers it", async () => {
    await signInAs(adminMobile);
    const branch = await makeBranch();
    await makeUser({
      role: "MANAGER",
      homeBranchId,
      extraBranchIds: [branch.id],
    });

    const result = await setBranchStatus({ id: branch.id, status: "INACTIVE" });
    expect(result).toMatchObject({
      ok: false,
      code: "RULE",
      message: "branches.errors.staffPresent",
    });
  });

  it("deactivates an empty branch without deleting it, and can activate it again", async () => {
    await signInAs(adminMobile);
    const branch = await makeBranch();

    expect((await setBranchStatus({ id: branch.id, status: "INACTIVE" })).ok).toBe(true);
    expect(await db.branch.findUnique({ where: { id: branch.id } })).toMatchObject({
      status: "INACTIVE",
      name: branch.name, // still there, only the status changed
    });

    expect((await setBranchStatus({ id: branch.id, status: "ACTIVE" })).ok).toBe(true);
    expect((await db.branch.findUnique({ where: { id: branch.id } }))?.status).toBe("ACTIVE");

    const actions = (await audit(branch.id)).map((row) => row.action);
    expect(actions).toEqual(["branch:deactivate", "branch:activate"]);
  });

  it("refuses to deactivate the only active branch left", async () => {
    await signInAs(adminMobile);
    const branch = await makeBranch();
    const others = await db.branch.findMany({
      where: { status: "ACTIVE", id: { not: branch.id } },
      select: { id: true },
    });

    await db.branch.updateMany({
      where: { id: { in: others.map((row) => row.id) } },
      data: { status: "INACTIVE" },
    });

    try {
      const result = await setBranchStatus({ id: branch.id, status: "INACTIVE" });
      expect(result).toMatchObject({
        ok: false,
        code: "RULE",
        message: "branches.errors.lastActiveBranch",
      });
    } finally {
      await db.branch.updateMany({
        where: { id: { in: others.map((row) => row.id) } },
        data: { status: "ACTIVE" },
      });
    }
  });
});

describe("permissions", () => {
  it("lets no manager add, change or deactivate a branch", async () => {
    await signInAs(managerMobile);
    const branch = await makeBranch();

    for (const result of [
      await createBranch(branchData(`Manager ${Date.now()}`)),
      await updateBranch({ ...branchData("Manager edit"), id: branch.id }),
      await setBranchStatus({ id: branch.id, status: "INACTIVE" }),
    ]) {
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
  });

  it("refuses when nobody is signed in", async () => {
    await signInAs(null);
    const result = await createBranch(branchData(`Nobody ${Date.now()}`));
    expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});
