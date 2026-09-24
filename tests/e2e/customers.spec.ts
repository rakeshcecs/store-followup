import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M05's "Done when": found, not found and invalid all work, and the same number cannot
// be saved twice.

test.describe("find and create a customer", () => {
  const users: string[] = [];
  const customers: string[] = [];

  test.afterAll(async () => {
    await db.timelineEvent.deleteMany({ where: { customerId: { in: customers } } });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  test("a salesperson adds a walk-in, and the same number cannot be added twice", async ({
    page,
  }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Walk-in Seller");
    users.push(sales.id);
    await signIn(page, sales.mobile, "SALESPERSON");

    // The way in is the button on Today, as in the prototype.
    await page.getByRole("link", { name: en.customers.findCta }).click();
    await expect(page).toHaveURL(/\/customers/);

    // Invalid: says so, and does not search.
    await page.getByLabel(en.customers.fields.mobile).fill("12345");
    await page.getByRole("button", { name: en.customers.search }).click();
    await expect(page.getByText(en.customers.errors.mobileInvalid)).toBeVisible();

    // Not found: offers to create, carrying the number.
    const mobile = randomMobile();
    await page.getByLabel(en.customers.fields.mobile).fill(mobile);
    await page.getByRole("button", { name: en.customers.search }).click();
    await expect(page.getByRole("link", { name: en.customers.create })).toBeVisible();
    await page.getByRole("link", { name: en.customers.create }).click();

    await expect(page).toHaveURL(new RegExp(`/customers/new\\?mobile=${mobile}`));
    await expect(page.getByLabel(en.customers.fields.mobile)).toHaveValue(mobile);

    await page.getByLabel(en.customers.fields.name).fill("Asha Patel");
    await page.getByRole("button", { name: en.customers.save }).click();

    // Straight into Record visit (M05.10).
    await expect(page).toHaveURL(/\/visits\/new\?customerId=/);

    const saved = await db.customer.findUniqueOrThrow({ where: { mobile } });
    customers.push(saved.id);
    expect(saved.consentGiven).toBe(true);
    expect(await db.timelineEvent.count({ where: { customerId: saved.id } })).toBe(1);

    // Found: the card, not a second row.
    await page.goto(`/customers?mobile=${mobile}`);
    await expect(page.getByText(en.customers.existing)).toBeVisible();
    await expect(page.getByText("Asha Patel")).toBeVisible();

    // And trying to create it again lands on that same card (M05.09).
    await page.goto(`/customers/new?mobile=${mobile}`);
    await page.getByLabel(en.customers.fields.name).fill("Someone Else");
    await page.getByRole("button", { name: en.customers.save }).click();
    await expect(page).toHaveURL(new RegExp(`/customers\\?mobile=${mobile}`));
    await expect(page.getByText(en.customers.existing)).toBeVisible();
    expect(await db.customer.count({ where: { mobile } })).toBe(1);
  });

  test("a manager finds the same customer from the overview", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Owner");
    const manager = await makeStaff("MANAGER", "E2E Finder");
    users.push(sales.id, manager.id);

    const mobile = randomMobile();
    const customer = await db.customer.create({
      data: {
        name: "Shared Customer",
        mobile,
        assignedToId: sales.id,
        homeBranchId: sales.homeBranchId,
      },
    });
    customers.push(customer.id);

    await signIn(page, manager.mobile, "MANAGER");
    // Manager and admin have no nav tab for this; the button on Overview is the way in.
    await page.getByRole("link", { name: en.customers.findCta }).click();

    await page.getByLabel(en.customers.fields.mobile).fill(mobile);
    await page.getByRole("button", { name: en.customers.search }).click();

    // Customers are shared across branches (BR-16), so this must work whoever asks.
    await expect(page.getByText("Shared Customer")).toBeVisible();
    await expect(page.getByText(en.customers.existing)).toBeVisible();
  });

  test("an admin looking at every branch is told to pick one first", async ({ page }) => {
    const admin = await makeStaff("ADMIN", "E2E All Branches Admin");
    users.push(admin.id);
    await signIn(page, admin.mobile, "ADMIN");

    // The switcher's "All branches" is a reading position, not a place a walk-in can
    // happen — the action refuses it, so the screen says so before Save is ever pressed.
    await page.getByRole("button", { name: en.branch.switch }).click();
    await page.getByRole("menuitemradio", { name: en.branch.all }).click();
    // The switch is a Server Action; wait for its confirmation before navigating, or the
    // next request can still carry the old cookie.
    await expect(page.getByText(en.branch.switched.replace("{name}", en.branch.all))).toBeVisible();

    await page.goto(`/customers/new?mobile=${randomMobile()}`);
    await expect(page.getByText(en.customers.pickBranch)).toBeVisible();
    await expect(page.getByRole("button", { name: en.customers.save })).toHaveCount(0);
  });

  test("the search works with JavaScript switched off", async ({ page, browser, baseURL }) => {
    // The screen is a GET form on purpose: in a shop with a bad connection the script may
    // simply never arrive, and finding a customer still has to work.
    const sales = await makeStaff("SALESPERSON", "E2E No Script");
    users.push(sales.id);
    const mobile = randomMobile();
    const customer = await db.customer.create({
      data: {
        name: "No Script Customer",
        mobile,
        assignedToId: sales.id,
        homeBranchId: sales.homeBranchId,
      },
    });
    customers.push(customer.id);

    // Logging in is a client form and does need a script (M02), so the session is taken
    // with one and carried into a context that has none.
    await signIn(page, sales.mobile, "SALESPERSON");
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });

    try {
      const plain = await context.newPage();
      await plain.goto("/customers");
      await plain.getByLabel(en.customers.fields.mobile).fill(mobile);
      await plain.getByRole("button", { name: en.customers.search }).click();

      await expect(plain).toHaveURL(new RegExp(`/customers\\?mobile=${mobile}`));
      await expect(plain.getByText("No Script Customer")).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
