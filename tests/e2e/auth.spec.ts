import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { E2E_PIN, makeStaff, signIn } from "./helpers";

// A user of its own rather than the seeded admin: the seeded one must change its PIN on
// first login, which would make this suite pass exactly once.

const SLOW = { timeout: 15_000 };

test.describe("login and access", () => {
  const created: string[] = [];
  const branches: string[] = [];

  test.afterAll(async () => {
    // Test rows only; the app itself never hard-deletes (CLAUDE.md).
    await db.notification.deleteMany({ where: { userId: { in: created } } });
    await db.auditLog.deleteMany({ where: { userId: { in: created } } });
    await db.user.deleteMany({ where: { id: { in: created } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  test("a signed-out visitor is sent to the login screen and back again", async ({ page }) => {
    await page.goto("/branches");
    await expect(page).toHaveURL(/\/login\?next=%2Fbranches/);
    await expect(page.getByRole("heading", { name: en.auth.title })).toBeVisible();
  });

  test("the wrong PIN never says which half was wrong", async ({ page }) => {
    const user = await makeStaff("MANAGER", "E2E Manager");
    created.push(user.id);

    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(user.mobile);
    await page.getByLabel(en.auth.fields.pin).fill("0007");
    await page.getByRole("button", { name: en.auth.logIn }).click();

    await expect(page.getByText(en.auth.errors.badCredentials)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a manager lands on the overview, sees their profile, and can log out", async ({ page }) => {
    const user = await makeStaff("MANAGER", "E2E Manager");
    created.push(user.id);

    await signIn(page, user.mobile, "MANAGER");
    await expect(page.getByRole("heading", { name: en.overview.title })).toBeVisible();

    await page.goto("/profile");
    await expect(page.getByText(user.fullName)).toBeVisible();
    // exact: the fixture is called "E2E Manager", which contains the role name too.
    await expect(page.getByText(en.roles.MANAGER, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: en.auth.logOut }).first().click();
    await expect(page).toHaveURL(/\/login/);

    // The session is really gone, not just forgotten by the screen.
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a manager cannot reach the admin-only branch screens", async ({ page }) => {
    const user = await makeStaff("MANAGER", "E2E Manager");
    created.push(user.id);

    await signIn(page, user.mobile, "MANAGER");

    const response = await page.goto("/branches");
    expect(response?.status()).toBe(404);
  });

  test("a locked-out account says so instead of letting the PIN be guessed", async ({ page }) => {
    // A branch of its own: locking an account notifies every manager and admin of that
    // branch inside one transaction, and aiming that at the branch every other spec is
    // using made ten workers queue on the same rows until this test timed out.
    const branch = await db.branch.create({
      data: {
        name: `E2E Lockout ${Math.random().toString(36).slice(2, 7)}`,
        address: "1 Test Road",
        city: "Ahmedabad",
        phone: "9825012345",
      },
    });
    branches.push(branch.id);
    const user = await makeStaff("MANAGER", "E2E Manager", branch.id);
    created.push(user.id);

    // Four wrong PINs already on the record, so this test spends two logins rather than
    // six. argon2 is meant to be slow, and six of them beside the rest of the suite made
    // this test time out about once in three runs. The counting itself, the lock window,
    // the notifications and the audit row are all covered in tests/db/auth-actions —
    // what only a browser can show is the two messages below.
    await db.user.update({ where: { id: user.id }, data: { failedPinCount: 4 } });

    // The fifth wrong PIN locks the account, and still says only "wrong": telling the
    // caller they have just locked it would confirm the number belongs to someone.
    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(user.mobile);
    await page.getByLabel(en.auth.fields.pin).fill("0007");
    await page.getByRole("button", { name: en.auth.logIn }).click();
    // argon2 is deliberately slow, and with the whole suite on one machine a single
    // verify has outlasted the five seconds an expect waits by default.
    await expect(page.getByText(en.auth.errors.badCredentials).first()).toBeVisible(SLOW);

    // Now even the right PIN is refused, and the screen says why.
    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(user.mobile);
    await page.getByLabel(en.auth.fields.pin).fill(E2E_PIN);
    await page.getByRole("button", { name: en.auth.logIn }).click();

    await expect(page.getByText(en.auth.errors.locked)).toBeVisible(SLOW);
    await expect(page).toHaveURL(/\/login/);
  });
});
