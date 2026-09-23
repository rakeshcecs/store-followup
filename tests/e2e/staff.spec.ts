import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// The SOW's "Done when" for M03: an admin adds a salesperson, who then logs in with the
// temporary PIN and sets their own.

test.describe("staff", () => {
  const created: string[] = [];

  test.afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: created } } });
    await db.$disconnect();
  });

  test("an admin adds a salesperson, who logs in with the temporary PIN", async ({ page }) => {
    const admin = await makeStaff("ADMIN", "E2E Admin");
    created.push(admin.id);
    await signIn(page, admin.mobile, "ADMIN");

    const newMobile = randomMobile();
    await page.goto("/staff/new");
    await page.getByLabel(en.staff.fields.name).fill("E2E Salesperson");
    await page.getByLabel(en.staff.fields.mobile).fill(newMobile);
    await page.getByRole("button", { name: en.staff.save }).click();

    // The temporary PIN is shown exactly once, here.
    await expect(page.getByText(en.staff.tempPin.title)).toBeVisible();
    const tempPin = (await page.locator("p.tracking-\\[0\\.35em\\]").innerText()).trim();
    expect(tempPin).toMatch(/^\d{4}$/);
    await page.getByRole("button", { name: en.staff.tempPin.done }).first().click();
    await expect(page).toHaveURL(/\/staff/);

    const person = await db.user.findUniqueOrThrow({ where: { mobile: newMobile } });
    created.push(person.id);

    // Log out and in again as the new person: the temporary PIN works once and then has
    // to be replaced.
    await page.getByRole("button", { name: en.auth.logOut }).first().click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel(en.auth.fields.mobile).fill(newMobile);
    await page.getByLabel(en.auth.fields.pin).fill(tempPin);
    await page.getByRole("button", { name: en.auth.logIn }).click();

    await expect(page).toHaveURL(/\/set-pin/);
    // exact: "New PIN" is also a substring of "Enter the new PIN again".
    await page.getByLabel(en.auth.fields.newPin, { exact: true }).fill("7261");
    await page.getByLabel(en.auth.fields.confirmPin).fill("7261");
    await page.getByRole("button", { name: en.auth.savePin }).click();

    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("heading", { name: en.today.title })).toBeVisible();
  });

  test("a manager sees the list but cannot add anyone", async ({ page }) => {
    const manager = await makeStaff("MANAGER", "E2E Staff Manager");
    created.push(manager.id);
    await signIn(page, manager.mobile, "MANAGER");

    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: en.staff.title })).toBeVisible();
    await expect(page.getByRole("link", { name: en.staff.add })).toHaveCount(0);
    // The one thing a manager may do here.
    await expect(page.getByRole("button", { name: en.staff.resetPin }).first()).toBeVisible();

    // Settings is admin-only, and so is the form.
    expect((await page.goto("/settings/departments"))?.status()).toBe(404);
  });
});
