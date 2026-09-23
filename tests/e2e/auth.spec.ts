import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { E2E_PIN, makeStaff, signIn } from "./helpers";

// A user of its own rather than the seeded admin: the seeded one must change its PIN on
// first login, which would make this suite pass exactly once.

test.describe("login and access", () => {
  const created: string[] = [];

  test.afterAll(async () => {
    // Test rows only; the app itself never hard-deletes (CLAUDE.md).
    await db.user.deleteMany({ where: { id: { in: created } } });
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
    // Six logins, and argon2 is meant to be slow: with every other spec on the same
    // machine this one test ran out of the default budget about once in three runs.
    test.slow();
    const user = await makeStaff("MANAGER", "E2E Manager");
    created.push(user.id);

    // BR: five wrong PINs lock the account (src/lib/validation/auth.ts).
    // The explicit timeout is the point of this test being slow: `test.slow()` raises the
    // test's own budget but not an expect's, and one argon2 verify with the whole suite on
    // the same machine can outlast the default five seconds.
    const wait = { timeout: 20_000 };
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto("/login");
      await page.getByLabel(en.auth.fields.mobile).fill(user.mobile);
      await page.getByLabel(en.auth.fields.pin).fill("0007");
      await page.getByRole("button", { name: en.auth.logIn }).click();
      await expect(page.getByText(en.auth.errors.badCredentials).first()).toBeVisible(wait);
    }

    // Now even the right PIN is refused, and the screen says why.
    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(user.mobile);
    await page.getByLabel(en.auth.fields.pin).fill(E2E_PIN);
    await page.getByRole("button", { name: en.auth.logIn }).click();

    await expect(page.getByText(en.auth.errors.locked)).toBeVisible(wait);
    await expect(page).toHaveURL(/\/login/);
  });
});
