import argon2 from "argon2";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The helper is imported lazily, inside cookies(): importing it in the factory would
// deadlock, because the helper reaches @/lib/session, which imports the very module
// this factory is still building.
vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { login, resetPin, setPin } = await import("@/lib/actions/auth");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { LOCK_MINUTES, MAX_FAILED_ATTEMPTS } = await import("@/lib/validation/auth");
const { makeBranch, makeUser, nextMobile } = await import("../helpers/branch-access");
const { signInAs } = await import("../helpers/session");
const { makeStore } = await import("../helpers/store");

const PIN = "4839";
const OTHER_PIN = "7261";

async function makeStaff(options: {
  role: "SALESPERSON" | "MANAGER" | "ADMIN";
  homeBranchId: string;
  pin?: string;
  mustChangePin?: boolean;
  status?: "ACTIVE" | "INACTIVE";
}) {
  const mobile = nextMobile();
  const user = await makeUser({ role: options.role, homeBranchId: options.homeBranchId, mobile });
  await db.user.update({
    where: { id: user.id },
    data: {
      pinHash: await argon2.hash(options.pin ?? PIN),
      mustChangePin: options.mustChangePin ?? false,
      status: options.status ?? "ACTIVE",
    },
  });
  return { id: user.id, mobile };
}

let branchId: string;

beforeEach(async () => {
  branchId = (await makeBranch()).id;
  await signInAs(null);
});

afterAll(() => db.$disconnect());

describe("login", () => {
  it("signs a staff member in and creates exactly one session", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });

    const result = await login({ mobile: staff.mobile, pin: PIN });

    expect(result).toMatchObject({ ok: true, data: { role: "SALESPERSON" } });
    expect(await db.session.count({ where: { userId: staff.id } })).toBe(1);
  });

  it("accepts the mobile in any shape the person types it", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    const spaced = `+91 ${staff.mobile.slice(0, 5)} ${staff.mobile.slice(5)}`;

    await expect(login({ mobile: spaced, pin: PIN })).resolves.toMatchObject({ ok: true });
  });

  it("saves the language chosen on the login screen onto the account", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });

    await login({ mobile: staff.mobile, pin: PIN, language: "gu" });

    const saved = await db.user.findUniqueOrThrow({ where: { id: staff.id } });
    expect(saved.language).toBe("gu");
  });

  it("gives the same message for an unknown mobile and a wrong PIN", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });

    const wrongPin = await login({ mobile: staff.mobile, pin: "0007" });
    const unknown = await login({ mobile: nextMobile(), pin: PIN });

    expect(wrongPin).toMatchObject({ ok: false, message: "auth.errors.badCredentials" });
    expect(unknown).toMatchObject({ ok: false, message: "auth.errors.badCredentials" });
    expect(await db.session.count({ where: { userId: staff.id } })).toBe(0);
  });

  it("refuses a deactivated account and says why", async () => {
    const staff = await makeStaff({
      role: "SALESPERSON",
      homeBranchId: branchId,
      status: "INACTIVE",
    });

    await expect(login({ mobile: staff.mobile, pin: PIN })).resolves.toMatchObject({
      ok: false,
      message: "auth.errors.inactive",
    });
  });

  it("counts wrong PINs and clears the count on a good one", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });

    await login({ mobile: staff.mobile, pin: "0007" });
    await login({ mobile: staff.mobile, pin: "0007" });
    expect((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).failedPinCount).toBe(2);

    await login({ mobile: staff.mobile, pin: PIN });
    expect((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).failedPinCount).toBe(0);
  });

  it("locks the account on the fifth wrong PIN, tells the managers and records it", async () => {
    const manager = await makeStaff({ role: "MANAGER", homeBranchId: branchId });
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      await login({ mobile: staff.mobile, pin: "0007" });
    }

    const locked = await db.user.findUniqueOrThrow({ where: { id: staff.id } });
    expect(locked.lockedUntil).not.toBeNull();
    const minutes = (locked.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(LOCK_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(LOCK_MINUTES);

    expect(
      await db.notification.count({ where: { userId: manager.id, type: "user-locked" } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: staff.id, action: AUDIT.userLocked } }),
    ).toBe(1);
  });

  it("refuses the right PIN while the account is locked", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    await db.user.update({
      where: { id: staff.id },
      data: { lockedUntil: new Date(Date.now() + 5 * 60_000) },
    });

    await expect(login({ mobile: staff.mobile, pin: PIN })).resolves.toMatchObject({
      ok: false,
      message: "auth.errors.locked",
    });
  });

  it("lets them back in once the lock has passed", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    await db.user.update({
      where: { id: staff.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    await expect(login({ mobile: staff.mobile, pin: PIN })).resolves.toMatchObject({ ok: true });
  });
});

describe("setPin", () => {
  it("replaces the PIN and signs every other device out", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    // An older session on another device, which must not survive the change.
    await db.session.create({
      data: { userId: staff.id, tokenHash: "other-device", expiresAt: new Date(Date.now() + 1000) },
    });
    await signInAs(staff.mobile);

    const result = await setPin({ currentPin: PIN, pin: OTHER_PIN, confirmPin: OTHER_PIN });

    expect(result).toMatchObject({ ok: true });
    const saved = await db.user.findUniqueOrThrow({ where: { id: staff.id } });
    expect(await argon2.verify(saved.pinHash, OTHER_PIN)).toBe(true);
    expect(saved.mustChangePin).toBe(false);
    expect(await db.session.count({ where: { userId: staff.id, tokenHash: "other-device" } })).toBe(
      0,
    );
  });

  it("refuses a wrong current PIN", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    await signInAs(staff.mobile);

    await expect(
      setPin({ currentPin: "0007", pin: OTHER_PIN, confirmPin: OTHER_PIN }),
    ).resolves.toMatchObject({ ok: false, message: "auth.errors.currentPinWrong" });
  });

  it("does not ask for the current PIN on a forced change", async () => {
    const staff = await makeStaff({
      role: "SALESPERSON",
      homeBranchId: branchId,
      mustChangePin: true,
    });
    await signInAs(staff.mobile);

    await expect(setPin({ pin: OTHER_PIN, confirmPin: OTHER_PIN })).resolves.toMatchObject({
      ok: true,
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).mustChangePin).toBe(
      false,
    );
  });

  it("refuses an obvious PIN", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    await signInAs(staff.mobile);

    await expect(
      setPin({ currentPin: PIN, pin: "1234", confirmPin: "1234" }),
    ).resolves.toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("refuses a signed-out caller", async () => {
    await expect(setPin({ pin: OTHER_PIN, confirmPin: OTHER_PIN })).resolves.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});

describe("resetPin", () => {
  it("lets a manager reset someone's PIN, forcing a change and ending their sessions", async () => {
    const manager = await makeStaff({ role: "MANAGER", homeBranchId: branchId });
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    await signInAs(staff.mobile); // the person about to be reset has a live session
    await signInAs(manager.mobile);

    const result = await resetPin({ userId: staff.id, pin: OTHER_PIN });

    expect(result).toMatchObject({ ok: true });
    const saved = await db.user.findUniqueOrThrow({ where: { id: staff.id } });
    expect(saved.mustChangePin).toBe(true);
    expect(await argon2.verify(saved.pinHash, OTHER_PIN)).toBe(true);
    expect(await db.session.count({ where: { userId: staff.id } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { entityId: staff.id, action: AUDIT.userPinReset } }),
    ).toBe(1);
  });

  it("refuses a salesperson: the spec's 403", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    const other = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    await signInAs(staff.mobile);

    await expect(resetPin({ userId: other.id, pin: OTHER_PIN })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a manager from another branch", async () => {
    const otherBranch = await makeBranch();
    const manager = await makeStaff({ role: "MANAGER", homeBranchId: otherBranch.id });
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    await signInAs(manager.mobile);

    await expect(resetPin({ userId: staff.id, pin: OTHER_PIN })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

// Found in the role audit (24 Sep 2026): a manager could reset the admin's PIN, read the
// new one off the screen and sign in as the admin. Two branches, two managers, two
// salespeople and an admin.
describe("resetPin: whose PIN a manager may reset", () => {
  const refused = { ok: false, code: "FORBIDDEN" };

  it("refuses a manager resetting the admin or another manager of their own branch", async () => {
    const store = await makeStore();
    const secondManagerA = await makeUser({ role: "MANAGER", homeBranchId: store.branchA.id });
    await signInAs(store.managerA.mobile);

    await expect(resetPin({ userId: store.admin.id, pin: OTHER_PIN })).resolves.toMatchObject(
      refused,
    );
    await expect(resetPin({ userId: secondManagerA.id, pin: OTHER_PIN })).resolves.toMatchObject(
      refused,
    );
    await expect(resetPin({ userId: store.managerB.id, pin: OTHER_PIN })).resolves.toMatchObject(
      refused,
    );
    // Nothing changed on the admin: same PIN hash, no audit row.
    const admin = await db.user.findUniqueOrThrow({ where: { id: store.admin.id } });
    expect(admin.pinHash).toBe(store.admin.pinHash);
    expect(
      await db.auditLog.count({ where: { entityId: store.admin.id, action: AUDIT.userPinReset } }),
    ).toBe(0);
  });

  it("lets a manager reset their own branch's salespeople only", async () => {
    const store = await makeStore();
    // Home in B, also works in A: A's manager lists them, so may reset them too.
    const alsoInA = await makeUser({
      role: "SALESPERSON",
      homeBranchId: store.branchB.id,
      extraBranchIds: [store.branchA.id],
    });
    await signInAs(store.managerA.mobile);

    await expect(resetPin({ userId: store.salesA.id })).resolves.toMatchObject({ ok: true });
    await expect(resetPin({ userId: alsoInA.id })).resolves.toMatchObject({ ok: true });
    await expect(resetPin({ userId: store.salesB.id })).resolves.toMatchObject(refused);
  });

  it("lets the admin reset a manager's PIN in any branch", async () => {
    const store = await makeStore();
    await signInAs(store.admin.mobile);

    await expect(resetPin({ userId: store.managerB.id })).resolves.toMatchObject({ ok: true });
    await expect(resetPin({ userId: store.salesB.id })).resolves.toMatchObject({ ok: true });
  });
});

describe("a session is only as alive as its user", () => {
  it("stops working the moment the user is deactivated", async () => {
    const staff = await makeStaff({ role: "SALESPERSON", homeBranchId: branchId });
    await signInAs(staff.mobile);
    await expect(
      setPin({ currentPin: PIN, pin: OTHER_PIN, confirmPin: OTHER_PIN }),
    ).resolves.toMatchObject({ ok: true });

    await db.user.update({ where: { id: staff.id }, data: { status: "INACTIVE" } });

    // Same cookie, same session row: the next call is already signed out.
    await expect(
      setPin({ currentPin: OTHER_PIN, pin: PIN, confirmPin: PIN }),
    ).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
