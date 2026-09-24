import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { SETTING } from "@/lib/settings";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M10's "Done when": a bought visit saves only with its bill, a duplicate bill is
// blocked, and a manager can correct or cancel a sale with a reason.

const s = en.sales;
const v = en.visits;

test.describe("sales", () => {
  const users: string[] = [];
  const customers: string[] = [];
  const categories: string[] = [];
  const branches: string[] = [];
  const tag = randomMobile().slice(-6);
  const categoryName = `E2E Lehenga ${tag}`;

  test.beforeAll(async () => {
    categories.push(
      (
        await db.requirementCategory.create({
          data: { nameEn: categoryName, nameHi: categoryName, nameGu: categoryName },
        })
      ).id,
    );
  });

  test.afterAll(async () => {
    const where = { customerId: { in: customers } };
    await db.timelineEvent.deleteMany({ where });
    await db.followUp.deleteMany({ where });
    await db.sale.deleteMany({ where });
    await db.visit.deleteMany({ where });
    await db.enquiry.deleteMany({ where });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.requirementCategory.deleteMany({ where: { id: { in: categories } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  async function customerOf(owner: { id: string; homeBranchId: string }, name: string) {
    const customer = await db.customer.create({
      data: {
        name,
        mobile: randomMobile(),
        assignedToId: owner.id,
        homeBranchId: owner.homeBranchId,
      },
    });
    customers.push(customer.id);
    return customer;
  }

  test("a bought visit is saved with its bill, and the same bill is then blocked", async ({
    page,
  }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Bill Seller");
    users.push(sales.id);
    const first = await customerOf(sales, "First Buyer");
    const second = await customerOf(sales, "Second Buyer");
    const bill = `E2E-${tag}`;
    await signIn(page, sales.mobile, "SALESPERSON");

    // Record visit → Yes → the sale screen, which saves both in one call.
    await page.goto(`/visits/new?customerId=${first.id}`);
    await page.getByRole("button", { name: categoryName }).click();
    await page.getByRole("radio", { name: new RegExp(v.outcome.PURCHASED.label) }).click();
    await page.getByRole("button", { name: v.nextBill }).click();
    await expect(page).toHaveURL(/\/sales\/new\?/);

    await expect(page.getByRole("button", { name: s.enterBill })).toBeDisabled();
    await page.getByLabel(s.billNumber).fill(bill.toLowerCase());
    await expect(page.getByText(s.billFree)).toBeVisible();
    // "Amount (₹)" or "Amount (optional)": the settings test beside this one may flip it.
    await page.getByLabel(/^Amount/).fill("12500");
    await page.getByRole("button", { name: s.save }).click();

    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByText(s.saved.replace("{bill}", bill))).toBeVisible();

    const visit = await db.visit.findFirstOrThrow({ where: { customerId: first.id } });
    const sale = await db.sale.findFirstOrThrow({ where: { customerId: first.id } });
    expect(visit.outcome).toBe("PURCHASED");
    expect(sale.enquiryId).toBe(visit.enquiryId);
    expect(sale.billNumber).toBe(bill);

    await page.goto(`/customers/${first.id}`);
    await expect(page.getByText(en.customers.profile.status.saleCompleted).first()).toBeVisible();
    // A salesperson cannot open the sale to change it — not even by its address, where the
    // answer is "not found", not an error page.
    await expect(page.getByRole("link", { name: en.timeline.saleCompleted })).toHaveCount(0);
    expect((await page.goto(`/sales/${sale.id}`))?.status()).toBe(404);

    // The same bill for another customer in the same branch: blocked before saving.
    await page.goto(`/visits/new?customerId=${second.id}`);
    await page.getByRole("button", { name: categoryName }).click();
    await page.getByRole("radio", { name: new RegExp(v.outcome.PURCHASED.label) }).click();
    await page.getByRole("button", { name: v.nextBill }).click();
    await page.getByLabel(s.billNumber).fill(bill);
    await expect(page.getByText(/This bill number is already saved for First Buyer/)).toBeVisible();
    await expect(page.getByRole("button", { name: s.fixBill })).toBeDisabled();
    expect(await db.visit.count({ where: { customerId: second.id } })).toBe(0);
  });

  test("a manager corrects a sale and then cancels it, each with a reason", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Credit Seller");
    // The manager works in two branches and signs in to the other one, so the switcher shows
    // a branch that is not the sale's: the sale must still open (M17).
    const home = await db.branch.create({
      data: {
        name: `E2E Sale Home ${randomMobile()}`,
        address: "1 Ring Road",
        city: "Surat",
        phone: "0261 123 4567",
      },
    });
    branches.push(home.id);
    const manager = await makeStaff("MANAGER", "E2E Sale Manager", home.id);
    await db.userBranch.create({ data: { userId: manager.id, branchId: sales.homeBranchId } });
    users.push(sales.id, manager.id);
    const saleBranch = await db.branch.findUniqueOrThrow({ where: { id: sales.homeBranchId } });
    const customer = await customerOf(sales, "Corrected Buyer");
    const enquiry = await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: sales.id, title: "Lehenga" },
    });
    const sale = await db.sale.create({
      data: {
        branchId: sales.homeBranchId,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: crypto.randomUUID(),
        billNumber: `FIX-${tag}`,
        billDate: new Date(),
        billAmount: 1000,
        salespersonId: sales.id,
      },
    });
    await db.timelineEvent.create({
      data: {
        customerId: customer.id,
        staffId: sales.id,
        type: "sale.completed",
        title: "timeline.saleCompleted",
        detail: sale.billNumber,
        entityId: sale.id,
        branchId: sale.branchId,
      },
    });
    await signIn(page, manager.mobile, "MANAGER");

    await page.goto(`/customers/${customer.id}`);
    // The history names the branch the sale was made in.
    await expect(page.getByText(`E2E Credit Seller · ${saleBranch.name}`)).toBeVisible();
    await page.getByRole("link", { name: en.timeline.saleCompleted }).click();
    await expect(page).toHaveURL(new RegExp(`/sales/${sale.id}`));

    await page.getByLabel(/^Amount/).fill("1500");
    await page.getByLabel(s.detail.reason).fill("Typed 1000 instead of 1500");
    await page.getByRole("button", { name: s.detail.saveEdit }).click();
    await expect(page.getByText(s.detail.edited)).toBeVisible();
    await expect
      .poll(async () =>
        Number((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).billAmount),
      )
      .toBe(1500);

    // On a phone the toast sits over the bottom of the screen, where Cancel is, and a
    // toast under the pointer never goes away — move the pointer off it and wait.
    await page.mouse.move(0, 0);
    await expect(page.getByText(s.detail.edited)).toBeHidden({ timeout: 10_000 });
    await page.getByLabel(s.detail.cancelReason).fill("Customer returned it");
    await page.getByRole("button", { name: s.detail.cancel }).click();
    await page.getByRole("button", { name: s.detail.cancelConfirm }).last().click();
    await expect(page.getByText(s.detail.cancelled, { exact: true })).toBeVisible();

    const after = await db.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(after.cancelled).toBe(true);
    expect(after.cancelReason).toBe("Customer returned it");

    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByText(en.timeline.saleEdited)).toBeVisible();
    await expect(page.getByText(en.timeline.saleCancelled)).toBeVisible();
  });

  test("the admin can make the bill amount optional", async ({ page }, testInfo) => {
    // One store-wide setting: run once, on the laptop screen an admin uses, so the phone
    // run cannot flip it back halfway through.
    test.skip(testInfo.project.name !== "desktop", "store-wide setting, desktop only");
    const admin = await makeStaff("ADMIN", "E2E Settings Admin");
    users.push(admin.id);
    await signIn(page, admin.mobile, "ADMIN");

    try {
      await page.goto("/settings");
      await page.getByRole("link", { name: new RegExp(en.settings.sales) }).click();
      const box = page.getByLabel(en.salesSettings.billAmountRequired);
      await expect(box).toBeChecked(); // required by default
      await box.uncheck();
      await page.getByRole("button", { name: en.salesSettings.save }).click();
      await expect(page.getByText(en.salesSettings.saved)).toBeVisible();

      await expect
        .poll(
          async () =>
            (await db.setting.findUnique({ where: { key: SETTING.billAmountRequired } }))?.value,
        )
        .toBe(false);
    } finally {
      // Store-wide: put it back for every other test running beside this one.
      await db.setting.deleteMany({ where: { key: SETTING.billAmountRequired } });
    }
  });
});
