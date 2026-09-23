import argon2 from "argon2";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";

// The SOW's "Done when" for M03: an admin adds a salesperson, who then logs in with the
// temporary PIN and sets their own.
const ADMIN_PIN = "4839";
const mobile = () => `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;

async function makeAdmin() {
  const branch = await db.branch.findFirstOrThrow({ where: { status: "ACTIVE" } });
  return db.user.create({
    data: {
      fullName: "E2E Admin",
      mobile: mobile(),
      role: "ADMIN",
      homeBranchId: branch.id,
      pinHash: await argon2.hash(ADMIN_PIN),
      mustChangePin: false,
    },
  });
}

test.describe("staff", () => {
  const created: string[] = [];

  test.afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: created } } });
    await db.$disconnect();
  });

  test("an admin adds a salesperson, who logs in with the temporary PIN", async ({ page }) => {
    const admin = await makeAdmin();
    created.push(admin.id);

    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(admin.mobile);
    await page.getByLabel(en.auth.fields.pin).fill(ADMIN_PIN);
    await page.getByRole("button", { name: en.auth.logIn }).click();
    await expect(page).toHaveURL(/\/overview/);

    const newMobile = mobile();
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
    await page.getByLabel(en.auth.fields.newPin).fill("7261");
    await page.getByLabel(en.auth.fields.confirmPin).fill("7261");
    await page.getByRole("button", { name: en.auth.savePin }).click();

    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("heading", { name: en.today.title })).toBeVisible();
  });

  test("a manager sees the list but cannot add anyone", async ({ page }) => {
    const branch = await db.branch.findFirstOrThrow({ where: { status: "ACTIVE" } });
    const manager = await db.user.create({
      data: {
        fullName: "E2E Manager",
        mobile: mobile(),
        role: "MANAGER",
        homeBranchId: branch.id,
        pinHash: await argon2.hash(ADMIN_PIN),
        mustChangePin: false,
      },
    });
    created.push(manager.id);

    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(manager.mobile);
    await page.getByLabel(en.auth.fields.pin).fill(ADMIN_PIN);
    await page.getByRole("button", { name: en.auth.logIn }).click();

    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: en.staff.title })).toBeVisible();
    await expect(page.getByRole("link", { name: en.staff.add })).toHaveCount(0);
    // The one thing a manager may do here.
    await expect(page.getByRole("button", { name: en.staff.resetPin }).first()).toBeVisible();

    // Settings is admin-only, and so is the form.
    expect((await page.goto("/settings/departments"))?.status()).toBe(404);
  });
});
