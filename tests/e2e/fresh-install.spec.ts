import { expect, test, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import gu from "../../messages/gu.json";
import { db } from "@/lib/db";

// One story, start to finish, on a database that has just been migrated and seeded:
// the seeded admin's first login through everything M01–M04 ships, then the same app
// seen by a manager and by a salesperson.
//
// It only passes on a virgin database (the seeded admin still has its first PIN), so it
// runs on demand, not in the normal suite.
test.describe.configure({ mode: "serial" });

const SEED_MOBILE = process.env.SEED_ADMIN_MOBILE ?? "9876543210";
const SEED_PIN = process.env.SEED_ADMIN_PIN ?? "1234";
const ADMIN_PIN = "8421";
const MANAGER_PIN = "7315";
const SALES_PIN = "6274";

const managerMobile = "9811100011";
const salesMobile = "9811100022";
const state: { managerTempPin?: string; salesTempPin?: string } = {};

// `landsOn` is not optional politeness: without waiting for the landing screen the next
// navigation can overtake the session cookie and look like a permission failure.
// `m` is the message bundle to read the screen in — the login screen keeps the language
// the last person chose, so after a Gujarati session it is in Gujarati.
async function logIn(page: Page, mobile: string, pin: string, landsOn?: RegExp, m: typeof en = en) {
  await page.goto("/login");
  await page.getByLabel(m.auth.fields.mobile).fill(mobile);
  await page.getByLabel(m.auth.fields.pin).fill(pin);
  await page.getByRole("button", { name: m.auth.logIn }).click();
  if (landsOn) await expect(page).toHaveURL(landsOn);
}

const OVERVIEW = /\/overview/;

async function setNewPin(page: Page, pin: string) {
  await expect(page).toHaveURL(/\/set-pin/);
  await page.getByLabel(en.auth.fields.newPin, { exact: true }).fill(pin);
  await page.getByLabel(en.auth.fields.confirmPin).fill(pin);
  await page.getByRole("button", { name: en.auth.savePin }).click();
}

// The label is a parameter because one step logs out of a Gujarati screen.
async function logOut(page: Page, label = en.auth.logOut) {
  await page.getByRole("button", { name: label }).first().click();
  await expect(page).toHaveURL(/\/login/);
}

// Adds a staff member and returns the temporary PIN shown once on the way out.
async function addStaff(page: Page, name: string, mobile: string, role: "MANAGER" | "SALESPERSON") {
  await page.goto("/staff/new");
  await page.getByLabel(en.staff.fields.name).fill(name);
  await page.getByLabel(en.staff.fields.mobile).fill(mobile);
  await page.getByLabel(en.staff.fields.role).selectOption(role);
  await page.getByRole("button", { name: en.staff.save }).click();

  await expect(page.getByText(en.staff.tempPin.title)).toBeVisible();
  const pin = (await page.locator("p.tracking-\\[0\\.35em\\]").innerText()).trim();
  expect(pin).toMatch(/^\d{4}$/);
  await page.getByRole("button", { name: en.staff.tempPin.done }).first().click();
  await expect(page).toHaveURL(/\/staff/);
  return pin;
}

test.afterAll(() => db.$disconnect());

test.describe("a store from an empty database", () => {
  // Running this against a database that has already been used would only report that
  // the seeded PIN has been changed, which is the point of step 2. `npm run test:e2e:fresh`
  // drops, migrates and seeds first and sets the flag.
  test.skip(
    !process.env.FRESH_INSTALL,
    "needs a freshly migrated and seeded database: npm run test:e2e:fresh",
  );

  test("1. nobody is signed in, so every screen is the login screen", async ({ page }) => {
    for (const path of ["/", "/today", "/overview", "/staff", "/settings", "/branches"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: en.auth.title }), path).toBeVisible();
    }
  });

  test("2. the seeded admin must replace the seeded PIN before anything else", async ({ page }) => {
    await logIn(page, SEED_MOBILE, SEED_PIN);

    // The PIN from .env is a shared secret, so it cannot survive the first login.
    await setNewPin(page, ADMIN_PIN);
    await expect(page).toHaveURL(/\/overview/);
    await expect(page.getByRole("heading", { name: en.overview.title })).toBeVisible();

    const admin = await db.user.findUniqueOrThrow({ where: { mobile: SEED_MOBILE } });
    expect(admin.mustChangePin).toBe(false);
  });

  test("3. the admin sees the seeded branch and adds a second one", async ({ page }) => {
    await logIn(page, SEED_MOBILE, ADMIN_PIN, OVERVIEW);
    await expect(page).toHaveURL(/\/overview/);

    await page.goto("/branches");
    await expect(page.getByRole("heading", { name: en.branches.title })).toBeVisible();

    await page.goto("/branches/new");
    await page.getByLabel(en.branches.fields.name).fill("Second Branch");
    await page.getByLabel(en.branches.fields.address).fill("14 Ring Road");
    await page.getByLabel(en.branches.fields.city).fill("Surat");
    await page.getByLabel(en.branches.fields.phone).fill("9825012345");
    await page.getByRole("button", { name: en.branches.save }).click();

    await expect(page).toHaveURL(/\/branches/);
    await expect(page.getByText("Second Branch")).toBeVisible();
    expect(await db.branch.count()).toBe(2);
  });

  test("4. the admin adds a department", async ({ page }) => {
    await logIn(page, SEED_MOBILE, ADMIN_PIN, OVERVIEW);
    await page.goto("/settings/departments");
    await expect(page.getByRole("heading", { name: en.departments.title })).toBeVisible();

    const before = await db.department.count();
    await page.getByLabel(en.departments.fields.name).fill("Alterations");
    await page.getByRole("button", { name: en.departments.add }).first().click();

    await expect(page.getByText("Alterations")).toBeVisible();
    expect(await db.department.count()).toBe(before + 1);
  });

  test("5. the admin adds a manager and a salesperson, each with a one-time PIN", async ({
    page,
  }) => {
    await logIn(page, SEED_MOBILE, ADMIN_PIN, OVERVIEW);

    state.managerTempPin = await addStaff(page, "Priya Manager", managerMobile, "MANAGER");
    state.salesTempPin = await addStaff(page, "Ravi Salesperson", salesMobile, "SALESPERSON");

    expect(state.managerTempPin).not.toBe(state.salesTempPin);
    for (const mobile of [managerMobile, salesMobile]) {
      const person = await db.user.findUniqueOrThrow({ where: { mobile } });
      expect(person.mustChangePin).toBe(true);
      expect(person.status).toBe("ACTIVE");
    }
  });

  test("6. the admin edits the master lists the visit screen will read", async ({ page }) => {
    await logIn(page, SEED_MOBILE, ADMIN_PIN, OVERVIEW);
    await page.goto("/settings/categories");

    // The nine seeded categories are there, and a category may be scoped to a branch.
    expect(await db.requirementCategory.count()).toBe(9);
    await expect(page.locator('form select[name="branchId"]').first()).toBeVisible();

    await page.getByLabel(en.masterLists.fields.nameEn).first().fill("Lehenga");
    await page.getByLabel(en.masterLists.fields.nameHi).first().fill("लहंगा");
    await page.getByLabel(en.masterLists.fields.nameGu).first().fill("લહેંગા");
    await page.getByRole("button", { name: en.masterLists.add }).first().click();

    await expect(page.getByText("Lehenga")).toBeVisible();
    const added = await db.requirementCategory.findFirstOrThrow({ where: { nameEn: "Lehenga" } });
    expect(added.branchId).toBeNull(); // shared by every branch (SOW M17.07)
    expect(added.sortOrder).toBe(10); // last in the list

    // Nothing uses it yet, so it can be deleted outright…
    const row = page.locator("li").filter({ hasText: "Lehenga" }).first();
    await row.getByRole("button", { name: en.masterLists.delete }).click();
    await page.getByRole("button", { name: en.masterLists.confirmDelete.confirm }).click();
    await expect(page.getByText("Lehenga")).toHaveCount(0);
    expect(await db.requirementCategory.count()).toBe(9);

    // …and the five seeded reasons behave the same way, minus the branch choice: a
    // reason has no branch column, so the form must not offer one.
    await page.goto("/settings/reasons");
    expect(await db.lostReason.count()).toBe(5);
    await expect(page.locator('form select[name="branchId"]')).toHaveCount(0);
  });

  test("7. the admin reads the app in Gujarati and switches back", async ({ page }) => {
    await logIn(page, SEED_MOBILE, ADMIN_PIN, OVERVIEW);
    await page.goto("/settings/categories");

    await page.getByRole("button", { name: en.language.switch }).click();
    await page.getByRole("menuitemradio", { name: "ગુજરાતી" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "gu");
    // A master list item is stored per language, so it changes with the screen.
    const seeded = await db.requirementCategory.findFirstOrThrow({ orderBy: { sortOrder: "asc" } });
    await expect(page.getByText(seeded.nameGu).first()).toBeVisible();
    await expect(page.getByRole("button", { name: gu.masterLists.add }).first()).toBeVisible();

    // The choice belongs to the person, not the browser: it survives a fresh login.
    await logOut(page, gu.auth.logOut);
    await logIn(page, SEED_MOBILE, ADMIN_PIN, OVERVIEW, gu);
    await expect(page.locator("html")).toHaveAttribute("lang", "gu");

    await page.getByRole("button", { name: gu.language.switch }).click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("8. the manager sets their own PIN, and sees a manager's app", async ({ page }) => {
    await logIn(page, managerMobile, state.managerTempPin!);
    await setNewPin(page, MANAGER_PIN);
    await expect(page).toHaveURL(/\/overview/);

    // Can read the staff list and reset a PIN…
    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: en.staff.title })).toBeVisible();
    await expect(page.getByRole("link", { name: en.staff.add })).toHaveCount(0);
    await expect(page.getByRole("button", { name: en.staff.resetPin }).first()).toBeVisible();

    // …and nothing that belongs to an admin.
    for (const path of [
      "/branches",
      "/settings",
      "/settings/departments",
      "/settings/categories",
    ]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });

  test("9. the salesperson sets their own PIN and lands on Today", async ({ page }) => {
    await logIn(page, salesMobile, state.salesTempPin!);
    await setNewPin(page, SALES_PIN);
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("heading", { name: en.today.title })).toBeVisible();

    // The overview and every admin screen are closed to them.
    for (const path of ["/overview", "/branches", "/settings", "/settings/categories"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });

  test("10. the salesperson changes their own PIN, and the old one stops working", async ({
    page,
  }) => {
    await logIn(page, salesMobile, SALES_PIN, /\/today/);
    await page.goto("/profile/pin");

    await page.getByLabel(en.auth.fields.currentPin).fill(SALES_PIN);
    await page.getByLabel(en.auth.fields.newPin, { exact: true }).fill("5193");
    await page.getByLabel(en.auth.fields.confirmPin).fill("5193");
    await page.getByRole("button", { name: en.auth.savePin }).click();
    await expect(page).toHaveURL(/\/profile/);

    await logOut(page);
    await logIn(page, salesMobile, SALES_PIN);
    await expect(page.getByText(en.auth.errors.badCredentials)).toBeVisible();

    await logIn(page, salesMobile, "5193", /\/today/);
  });

  test("11. the audit log has a row for everything that changed", async () => {
    const actions = await db.auditLog.groupBy({ by: ["action"], _count: true });
    const byAction = Object.fromEntries(actions.map((row) => [row.action, row._count]));

    // Nothing in M01–M04 changes data without leaving a trace.
    for (const action of ["branch:create", "department:create", "user:create", "category:create"]) {
      expect(byAction[action], action).toBeGreaterThanOrEqual(1);
    }
    expect(byAction["category:delete"]).toBe(1);
  });
});
