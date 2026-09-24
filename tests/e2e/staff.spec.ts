import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// The SOW's "Done when" for M03: an admin adds a salesperson, who then logs in with the
// temporary PIN and sets their own.

test.describe("staff", () => {
  const created: string[] = [];
  const branches: string[] = [];

  test.afterAll(async () => {
    await db.userBranch.deleteMany({ where: { userId: { in: created } } });
    await db.user.deleteMany({ where: { id: { in: created } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
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
    await expect(page.getByRole("link", { name: en.customers.findCta })).toBeVisible();
  });

  test("an admin gives a manager a second branch, and the switcher appears", async ({ page }) => {
    // Until now this could only be done by editing the database — the seed did it. SOW:
    // "Admin can give a manager access to more than one branch."
    const admin = await makeStaff("ADMIN", "E2E Branch Admin");
    created.push(admin.id);
    const second = await db.branch.create({
      data: {
        name: `E2E Second ${Math.random().toString(36).slice(2, 7)}`,
        address: "14 Ring Road",
        city: "Surat",
        phone: "9825012345",
      },
    });
    branches.push(second.id);

    await signIn(page, admin.mobile, "ADMIN");
    const managerMobile = randomMobile();
    await page.goto("/staff/new");
    await page.getByLabel(en.staff.fields.name).fill("Two Branch Manager");
    await page.getByLabel(en.staff.fields.mobile).fill(managerMobile);
    await page.getByLabel(en.staff.fields.role).selectOption("MANAGER");

    // The chips only exist for a manager, and never offer the home branch.
    const chips = page.getByRole("toolbar", { name: en.staff.fields.extraBranches });
    await expect(chips).toBeVisible();
    await chips.getByRole("button", { name: second.name }).click();
    await page.getByRole("button", { name: en.staff.save }).click();

    const pin = (await page.locator("p.tracking-\\[0\\.35em\\]").innerText()).trim();
    await page.getByRole("button", { name: en.staff.tempPin.done }).first().click();

    const manager = await db.user.findUniqueOrThrow({ where: { mobile: managerMobile } });
    created.push(manager.id);
    expect(await db.userBranch.count({ where: { userId: manager.id } })).toBe(1);
    // And the list says so, instead of hiding it behind the edit screen.
    // .first(): the demo seed has a two-branch manager of its own.
    await expect(page.getByText("+1 more branch").first()).toBeVisible();

    // The manager themselves can now reach both branches.
    await page.getByRole("button", { name: en.auth.logOut }).first().click();
    await page.getByLabel(en.auth.fields.mobile).fill(managerMobile);
    await page.getByLabel(en.auth.fields.pin).fill(pin);
    await page.getByRole("button", { name: en.auth.logIn }).click();
    await expect(page).toHaveURL(/\/set-pin/);
    await page.getByLabel(en.auth.fields.newPin, { exact: true }).fill("7248");
    await page.getByLabel(en.auth.fields.confirmPin).fill("7248");
    await page.getByRole("button", { name: en.auth.savePin }).click();
    await expect(page).toHaveURL(/\/overview/);

    await page.getByRole("button", { name: en.branch.switch }).click();
    await expect(page.getByRole("menuitemradio", { name: second.name })).toBeVisible();
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

  test("a manager's search stays inside their branch", async ({ page }) => {
    // The search and the branch filter are both an OR; spread into one object, the
    // search used to replace the branch filter and list every branch's staff.
    const name = `Search Scope ${randomMobile()}`;
    const [branchA, branchB] = await Promise.all(
      ["A", "B"].map((letter) =>
        db.branch.create({
          data: { name: `${name} ${letter}`, address: "1 Road", city: "Surat", phone: "0261 1234567" },
        }),
      ),
    );
    branches.push(branchA!.id, branchB!.id);
    const manager = await makeStaff("MANAGER", `${name} Manager A`, branchA!.id);
    const own = await makeStaff("SALESPERSON", `${name} Seller A`, branchA!.id);
    const other = await makeStaff("SALESPERSON", `${name} Seller B`, branchB!.id);
    created.push(manager.id, own.id, other.id);

    await signIn(page, manager.mobile, "MANAGER");
    await page.goto(`/staff?q=${encodeURIComponent(name)}`);
    await expect(page.getByText(`${name} Seller A`)).toBeVisible();
    await expect(page.getByText(`${name} Seller B`)).toHaveCount(0);
    await page.goto(`/staff?q=${other.mobile}`);
    await expect(page.getByText(`${name} Seller B`)).toHaveCount(0);
  });
});
