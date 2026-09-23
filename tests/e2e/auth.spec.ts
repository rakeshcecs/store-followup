import argon2 from "argon2";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";

// A user of its own rather than the seeded admin: the seeded one must change its PIN on
// first login, which would make this suite pass exactly once.
const PIN = "4839";
const mobile = () => `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;

async function makeManager() {
  const branch = await db.branch.findFirstOrThrow({ where: { status: "ACTIVE" } });
  const user = await db.user.create({
    data: {
      fullName: "E2E Manager",
      mobile: mobile(),
      role: "MANAGER",
      homeBranchId: branch.id,
      pinHash: await argon2.hash(PIN),
      mustChangePin: false,
    },
  });
  return user;
}

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
    const user = await makeManager();
    created.push(user.id);

    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(user.mobile);
    await page.getByLabel(en.auth.fields.pin).fill("0007");
    await page.getByRole("button", { name: en.auth.logIn }).click();

    await expect(page.getByText(en.auth.errors.badCredentials)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a manager lands on the overview, sees their profile, and can log out", async ({ page }) => {
    const user = await makeManager();
    created.push(user.id);

    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(user.mobile);
    await page.getByLabel(en.auth.fields.pin).fill(PIN);
    await page.getByRole("button", { name: en.auth.logIn }).click();

    await expect(page).toHaveURL(/\/overview/);
    await expect(page.getByRole("heading", { name: en.overview.title })).toBeVisible();

    await page.goto("/profile");
    await expect(page.getByText(user.fullName)).toBeVisible();
    await expect(page.getByText(en.roles.MANAGER)).toBeVisible();

    await page.getByRole("button", { name: en.auth.logOut }).first().click();
    await expect(page).toHaveURL(/\/login/);

    // The session is really gone, not just forgotten by the screen.
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a manager cannot reach the admin-only branch screens", async ({ page }) => {
    const user = await makeManager();
    created.push(user.id);

    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(user.mobile);
    await page.getByLabel(en.auth.fields.pin).fill(PIN);
    await page.getByRole("button", { name: en.auth.logIn }).click();
    await expect(page).toHaveURL(/\/overview/);

    const response = await page.goto("/branches");
    expect(response?.status()).toBe(404);
  });
});
