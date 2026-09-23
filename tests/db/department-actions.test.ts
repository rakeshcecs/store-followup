import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createDepartment, renameDepartment, setDepartmentStatus } =
  await import("@/app/(admin)/settings/departments/actions");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { makeBranch, makeUser, nextMobile } = await import("../helpers/branch-access");
const { signInAs } = await import("../helpers/session");

const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 8)}`;

let branchId: string;
let adminMobile: string;

beforeEach(async () => {
  branchId = (await makeBranch()).id;
  adminMobile = nextMobile();
  await makeUser({ role: "ADMIN", homeBranchId: branchId, mobile: adminMobile });
  await signInAs(adminMobile);
});

afterAll(() => db.$disconnect());

describe("createDepartment", () => {
  it("adds one and records it", async () => {
    const name = unique("Sales");
    const result = await createDepartment({ name });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = await db.department.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(saved.name).toBe(name);
    expect(saved.status).toBe("ACTIVE");
    expect(
      await db.auditLog.count({ where: { entityId: saved.id, action: AUDIT.departmentCreate } }),
    ).toBe(1);
  });

  it("refuses a name that already exists", async () => {
    const name = unique("Repairs");
    await createDepartment({ name });

    await expect(createDepartment({ name })).resolves.toMatchObject({
      ok: false,
      message: "departments.errors.nameTaken",
      field: "name",
    });
  });

  it("refuses a manager", async () => {
    const managerMobile = nextMobile();
    await makeUser({ role: "MANAGER", homeBranchId: branchId, mobile: managerMobile });
    await signInAs(managerMobile);

    await expect(createDepartment({ name: unique("Nope") })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("renameDepartment", () => {
  it("renames and keeps both names in the audit row", async () => {
    const created = await createDepartment({ name: unique("Old") });
    if (!created.ok) throw new Error("setup failed");
    const newName = unique("New");

    const result = await renameDepartment({ id: created.data.id, name: newName });

    expect(result.ok).toBe(true);
    expect((await db.department.findUniqueOrThrow({ where: { id: created.data.id } })).name).toBe(
      newName,
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: created.data.id, action: AUDIT.departmentUpdate },
    });
    expect(audit.newValue).toMatchObject({ name: newName });
  });
});

describe("setDepartmentStatus", () => {
  it("deactivates even when staff still belong to it — a warning, not a block", async () => {
    const created = await createDepartment({ name: unique("Floor") });
    if (!created.ok) throw new Error("setup failed");
    const person = await makeUser({ role: "SALESPERSON", homeBranchId: branchId });
    await db.user.update({ where: { id: person.id }, data: { departmentId: created.data.id } });

    const result = await setDepartmentStatus({ id: created.data.id, status: "INACTIVE" });

    expect(result.ok).toBe(true);
    // The person keeps the department: nothing is deleted, it just stops being offered.
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).departmentId).toBe(
      created.data.id,
    );
    expect(
      await db.auditLog.count({
        where: { entityId: created.data.id, action: AUDIT.departmentDeactivate },
      }),
    ).toBe(1);
  });

  it("does nothing when the status is already what was asked for", async () => {
    const created = await createDepartment({ name: unique("Same") });
    if (!created.ok) throw new Error("setup failed");

    const result = await setDepartmentStatus({ id: created.data.id, status: "ACTIVE" });

    expect(result.ok).toBe(true);
    expect(
      await db.auditLog.count({
        where: { entityId: created.data.id, action: AUDIT.departmentActivate },
      }),
    ).toBe(0);
  });
});
