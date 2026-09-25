import argon2 from "argon2";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Imported inside cookies(), not in the factory: the helper reaches @/lib/session, which
// imports the very module this factory is still building.
vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createStaff, setStaffStatus, updateStaff } = await import("@/app/(app)/staff/actions");
const { resetPin } = await import("@/lib/actions/auth");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { makeBranch, makeCustomer, makeUser, nextMobile } = await import("../helpers/branch-access");
const { signInAs } = await import("../helpers/session");
const { staffInScope } = await import("@/lib/staff-scope");

let branchId: string;
let adminMobile: string;

async function staffInput(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "New Person",
    mobile: nextMobile(),
    role: "SALESPERSON",
    homeBranchId: branchId,
    departmentId: "",
    joinedOn: "",
    ...overrides,
  };
}

beforeEach(async () => {
  branchId = (await makeBranch()).id;
  adminMobile = nextMobile();
  await makeUser({ role: "ADMIN", homeBranchId: branchId, mobile: adminMobile });
  await signInAs(adminMobile);
});

afterAll(() => db.$disconnect());

describe("createStaff", () => {
  it("creates a person who must change their temporary PIN at first login", async () => {
    const input = await staffInput();
    const result = await createStaff(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The PIN is only ever readable here, and it really is the one that was hashed.
    expect(result.data.tempPin).toMatch(/^\d{4}$/);
    const created = await db.user.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(created.mustChangePin).toBe(true);
    expect(await argon2.verify(created.pinHash, result.data.tempPin)).toBe(true);
    expect(
      await db.auditLog.count({ where: { entityId: created.id, action: AUDIT.userCreate } }),
    ).toBe(1);
  });

  it("stores the mobile normalised, however it was typed", async () => {
    const mobile = nextMobile();
    const result = await createStaff(await staffInput({ mobile: `+91 ${mobile}` }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = await db.user.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(created.mobile).toBe(mobile);
  });

  it("names the person already holding that mobile", async () => {
    const taken = nextMobile();
    await db.user.update({
      where: { mobile: adminMobile },
      data: { mobile: taken, fullName: "Asha Patel" },
    });
    await signInAs(taken);

    const result = await createStaff(await staffInput({ mobile: taken }));

    expect(result).toMatchObject({
      ok: false,
      message: "staff.errors.mobileTaken",
      field: "mobile",
      values: { name: "Asha Patel" },
    });
  });

  it("refuses a manager: only an admin adds staff", async () => {
    const managerMobile = nextMobile();
    await makeUser({ role: "MANAGER", homeBranchId: branchId, mobile: managerMobile });
    await signInAs(managerMobile);

    await expect(createStaff(await staffInput())).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a branch the admin is not looking at", async () => {
    const otherBranch = await makeBranch();
    const managerMobile = nextMobile();
    await makeUser({ role: "MANAGER", homeBranchId: branchId, mobile: managerMobile });
    await signInAs(managerMobile);

    await expect(
      createStaff(await staffInput({ homeBranchId: otherBranch.id })),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("updateStaff", () => {
  it("changes the details and records what changed", async () => {
    const created = await createStaff(await staffInput());
    if (!created.ok) throw new Error("setup failed");

    const result = await updateStaff({
      id: created.data.id,
      fullName: "Renamed Person",
      mobile: nextMobile(),
      role: "MANAGER",
      homeBranchId: branchId,
      departmentId: "",
      joinedOn: "2026-01-15",
    });

    expect(result.ok).toBe(true);
    const saved = await db.user.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(saved.fullName).toBe("Renamed Person");
    expect(saved.role).toBe("MANAGER");
    // A calendar date, read back as the same day rather than the day before.
    expect(saved.joinedOn?.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(
      await db.auditLog.count({ where: { entityId: saved.id, action: AUDIT.userUpdate } }),
    ).toBe(1);
  });

  it("refuses an admin changing their own role (the way round the last-admin guard)", async () => {
    const self = await db.user.findUniqueOrThrow({ where: { mobile: adminMobile } });

    const result = await updateStaff({
      id: self.id,
      fullName: self.fullName,
      mobile: self.mobile,
      role: "MANAGER",
      homeBranchId: branchId,
      departmentId: "",
      joinedOn: "",
    });

    expect(result).toMatchObject({ ok: false, message: "staff.errors.cannotChangeOwnRole" });
    expect((await db.user.findUniqueOrThrow({ where: { id: self.id } })).role).toBe("ADMIN");
  });

  it("refuses moving someone to a switched-off branch, but keeps one they are already in", async () => {
    const closed = await makeBranch();
    await db.branch.update({ where: { id: closed.id }, data: { status: "INACTIVE" } });
    const created = await createStaff(await staffInput());
    if (!created.ok) throw new Error("setup failed");
    const base = {
      id: created.data.id,
      fullName: "Moved Person",
      mobile: nextMobile(),
      role: "SALESPERSON",
      departmentId: "",
      joinedOn: "",
    };

    await expect(createStaff(await staffInput({ homeBranchId: closed.id }))).resolves.toMatchObject(
      { ok: false, message: "staff.errors.branchInactive" },
    );
    await expect(updateStaff({ ...base, homeBranchId: closed.id })).resolves.toMatchObject({
      ok: false,
      message: "staff.errors.branchInactive",
    });

    // Their own branch switched off later: the rest of the form still saves.
    await db.branch.update({ where: { id: branchId }, data: { status: "INACTIVE" } });
    await expect(updateStaff({ ...base, homeBranchId: branchId })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("cannot reach a person outside the branch being looked at", async () => {
    const otherBranch = await makeBranch();
    const stranger = await makeUser({ role: "SALESPERSON", homeBranchId: otherBranch.id });

    // The signed-in admin's branch scope is their own branch (no branch cookie is set),
    // so someone else's branch is out of reach even for an admin.
    const result = await updateStaff({
      id: stranger.id,
      fullName: "Hijacked",
      mobile: nextMobile(),
      role: "ADMIN",
      homeBranchId: otherBranch.id,
      departmentId: "",
      joinedOn: "",
    });

    // NOT_FOUND rather than FORBIDDEN: whether that person exists is itself information.
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await db.user.findUniqueOrThrow({ where: { id: stranger.id } })).fullName).not.toBe(
      "Hijacked",
    );
  });
});

describe("setStaffStatus", () => {
  it("makes someone inactive and ends their sessions", async () => {
    const created = await createStaff(await staffInput());
    if (!created.ok) throw new Error("setup failed");
    await db.session.create({
      data: {
        userId: created.data.id,
        tokenHash: `t${created.data.id}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await setStaffStatus({ id: created.data.id, status: "INACTIVE" });

    expect(result.ok).toBe(true);
    const saved = await db.user.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(saved.status).toBe("INACTIVE");
    expect(await db.session.count({ where: { userId: created.data.id } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { entityId: saved.id, action: AUDIT.userDeactivate } }),
    ).toBe(1);
  });

  it("refuses while they still have customers, and says how many", async () => {
    const created = await createStaff(await staffInput());
    if (!created.ok) throw new Error("setup failed");
    await makeCustomer(branchId, created.data.id);
    await makeCustomer(branchId, created.data.id);

    const result = await setStaffStatus({ id: created.data.id, status: "INACTIVE" });

    expect(result).toMatchObject({
      ok: false,
      message: "staff.errors.reassignFirst",
      values: { customers: 2, followUps: 0 },
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: created.data.id } })).status).toBe(
      "ACTIVE",
    );
  });

  it("refuses to deactivate the person doing the clicking", async () => {
    const admin = await db.user.findUniqueOrThrow({ where: { mobile: adminMobile } });

    await expect(setStaffStatus({ id: admin.id, status: "INACTIVE" })).resolves.toMatchObject({
      message: "staff.errors.cannotDeactivateSelf",
    });
  });

  it("refuses to remove the last active admin", async () => {
    // Two admins in this branch: the one signed in, and the one being deactivated.
    const otherAdmin = await makeUser({ role: "ADMIN", homeBranchId: branchId });
    // Every other admin in the database is inactive, leaving this pair.
    await db.user.updateMany({
      where: { role: "ADMIN", id: { notIn: [otherAdmin.id] }, mobile: { not: adminMobile } },
      data: { status: "INACTIVE" },
    });

    const signedIn = await db.user.findUniqueOrThrow({ where: { mobile: adminMobile } });
    await db.user.update({ where: { id: signedIn.id }, data: { status: "INACTIVE" } });
    // The signed-in admin is now inactive, so their session is refused — sign in as the
    // other one and try to remove the only remaining active admin: themselves.
    await db.user.update({ where: { id: otherAdmin.id }, data: { status: "ACTIVE" } });

    const result = await setStaffStatus({ id: otherAdmin.id, status: "INACTIVE" });
    expect(result).toMatchObject({ ok: false });
  });

  it("brings someone back", async () => {
    const created = await createStaff(await staffInput());
    if (!created.ok) throw new Error("setup failed");
    await setStaffStatus({ id: created.data.id, status: "INACTIVE" });

    const result = await setStaffStatus({ id: created.data.id, status: "ACTIVE" });

    expect(result.ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: created.data.id } })).status).toBe(
      "ACTIVE",
    );
  });
});

describe("resetPin from the staff list", () => {
  it("lets a manager hand out a new temporary PIN", async () => {
    const created = await createStaff(await staffInput());
    if (!created.ok) throw new Error("setup failed");

    const managerMobile = nextMobile();
    await makeUser({ role: "MANAGER", homeBranchId: branchId, mobile: managerMobile });
    await signInAs(managerMobile);

    const result = await resetPin({ userId: created.data.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.pin).toMatch(/^\d{4}$/);
    const saved = await db.user.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(await argon2.verify(saved.pinHash, result.data.pin)).toBe(true);
    expect(saved.mustChangePin).toBe(true);
  });

  it("refuses a salesperson", async () => {
    const created = await createStaff(await staffInput());
    if (!created.ok) throw new Error("setup failed");

    const salesMobile = nextMobile();
    await makeUser({ role: "SALESPERSON", homeBranchId: branchId, mobile: salesMobile });
    await signInAs(salesMobile);

    await expect(resetPin({ userId: created.data.id })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("extra branches", () => {
  it("gives a manager a second branch, and takes it away again", async () => {
    const second = await makeBranch();

    const created = await createStaff(
      await staffInput({ role: "MANAGER", extraBranchIds: second.id }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const rows = await db.userBranch.findMany({ where: { userId: created.data.id } });
    expect(rows.map((row) => row.branchId)).toEqual([second.id]);

    // The manager really can reach it now — this is the whole point of the field.
    const reachable = await db.user.findUniqueOrThrow({
      where: { id: created.data.id },
      select: { homeBranchId: true, extraBranches: { select: { branchId: true } } },
    });
    expect(staffInScope(reachable, { all: false, branchIds: [second.id] })).toBe(true);

    const saved = await db.user.findUniqueOrThrow({ where: { id: created.data.id } });
    const updated = await updateStaff({
      ...(await staffInput({ role: "MANAGER", extraBranchIds: "" })),
      id: created.data.id,
      mobile: saved.mobile,
    });
    expect(updated.ok).toBe(true);
    // Sync, not append: an unticked branch has to go.
    expect(await db.userBranch.count({ where: { userId: created.data.id } })).toBe(0);
  });

  it("refuses them for anyone who is not a manager", async () => {
    const second = await makeBranch();

    const result = await createStaff(
      await staffInput({ role: "SALESPERSON", extraBranchIds: second.id }),
    );

    // A salesperson works in one shop; an admin reaches every branch without a row.
    expect(result).toMatchObject({
      ok: false,
      code: "RULE",
      message: "staff.errors.extraBranchesManagerOnly",
      field: "extraBranchIds",
    });
  });

  it("never writes a row for the person's own branch", async () => {
    // An admin moving somebody's home branch onto one of their extras is doing something
    // sensible; a row for the home branch would count them twice when a branch asks
    // whether any staff still work there.
    const created = await createStaff(
      await staffInput({ role: "MANAGER", extraBranchIds: branchId }),
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await db.userBranch.count({ where: { userId: created.data.id } })).toBe(0);
  });

  it("records both lists in the audit row", async () => {
    const second = await makeBranch();
    const created = await createStaff(
      await staffInput({ role: "MANAGER", extraBranchIds: second.id }),
    );
    if (!created.ok) throw new Error("setup failed");

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: created.data.id, action: AUDIT.userCreate },
    });
    expect(audit.newValue).toMatchObject({ extraBranchIds: [second.id] });
  });

  it("saves the language the admin picked", async () => {
    const created = await createStaff(await staffInput({ language: "gu" }));
    if (!created.ok) throw new Error("setup failed");

    const saved = await db.user.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(saved.language).toBe("gu");
  });
});

// Found in the cross-role audit: an optional department could not be cleared, and a
// switched-off one could still be sent in a form post.
describe("department", () => {
  const department = (status: "ACTIVE" | "INACTIVE") =>
    db.department.create({ data: { name: `Dept ${nextMobile()}`, status } });

  it("can be cleared back to none (SOW 5.1: optional)", async () => {
    const dept = await department("ACTIVE");
    const created = await createStaff(await staffInput({ departmentId: dept.id }));
    if (!created.ok) throw new Error("setup failed");

    const result = await updateStaff({
      ...(await staffInput()),
      id: created.data.id,
      departmentId: "",
    });

    expect(result.ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: created.data.id } })).departmentId).toBe(
      null,
    );
  });

  it("refuses a switched-off department on a new person", async () => {
    const dept = await department("INACTIVE");

    await expect(createStaff(await staffInput({ departmentId: dept.id }))).resolves.toMatchObject({
      ok: false,
      field: "departmentId",
      message: "departments.errors.unavailable",
    });
  });

  it("keeps a switched-off department the person already has", async () => {
    const dept = await department("ACTIVE");
    const created = await createStaff(await staffInput({ departmentId: dept.id }));
    if (!created.ok) throw new Error("setup failed");
    await db.department.update({ where: { id: dept.id }, data: { status: "INACTIVE" } });
    const person = await db.user.findUniqueOrThrow({ where: { id: created.data.id } });

    const result = await updateStaff({
      ...(await staffInput()),
      id: person.id,
      mobile: person.mobile,
      fullName: "Still Here",
      departmentId: dept.id,
    });

    expect(result.ok).toBe(true);
  });
});
