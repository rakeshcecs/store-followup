import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M07's "Done when": a not-interested visit saves on its own; "Yes" and "No" never save
// a visit without the sale or follow-up, they hand a draft on instead.

const v = en.visits;

test.describe("record a visit", () => {
  const users: string[] = [];
  const customers: string[] = [];
  const branches: string[] = [];
  const categories: string[] = [];
  const reasons: string[] = [];
  const tag = randomMobile().slice(-5);
  const categoryName = `E2E Sherwani ${tag}`;
  const reasonName = `E2E Too costly ${tag}`;

  test.beforeAll(async () => {
    categories.push(
      (
        await db.requirementCategory.create({
          data: { nameEn: categoryName, nameHi: categoryName, nameGu: categoryName },
        })
      ).id,
    );
    reasons.push(
      (
        await db.lostReason.create({
          data: { nameEn: reasonName, nameHi: reasonName, nameGu: reasonName },
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
    await db.lostReason.deleteMany({ where: { id: { in: reasons } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  async function customerOf(sales: { id: string; homeBranchId: string }, name: string) {
    const customer = await db.customer.create({
      data: {
        name,
        mobile: randomMobile(),
        assignedToId: sales.id,
        homeBranchId: sales.homeBranchId,
      },
    });
    customers.push(customer.id);
    return customer;
  }

  test("not interested saves the visit, closes the enquiry and goes home", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Visit Seller");
    users.push(sales.id);
    const customer = await customerOf(sales, "Visit Customer");
    await signIn(page, sales.mobile, "SALESPERSON");

    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("link", { name: en.customers.profile.addVisit }).click();
    await expect(page.getByText("Handled by E2E Visit Seller")).toBeVisible();
    await expect(page.getByRole("button", { name: v.chooseAnswer })).toBeDisabled();

    await page.getByRole("button", { name: categoryName }).click();
    await page.getByLabel(v.remarks).fill("Found it too costly");
    await page.getByRole("radio", { name: new RegExp(v.outcome.NOT_INTERESTED.label) }).click();
    await page.getByRole("radio", { name: reasonName }).click();
    await page.getByRole("button", { name: v.saveAndClose }).click();

    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByText(v.saved)).toBeVisible();

    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByText(en.customers.profile.status.notInterested).first()).toBeVisible();
    await expect(page.getByText(en.timeline.visit, { exact: true })).toBeVisible();
    await expect(page.getByText("Found it too costly")).toBeVisible();

    const visit = await db.visit.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(visit.visitType).toBe("NEW");
    expect(visit.branchId).toBe(sales.homeBranchId);
  });

  test("yes keeps a draft for the sale screen and saves nothing yet", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Draft Seller");
    users.push(sales.id);
    const customer = await customerOf(sales, "Draft Customer");
    await signIn(page, sales.mobile, "SALESPERSON");

    await page.goto(`/visits/new?customerId=${customer.id}`);
    await page.getByRole("button", { name: categoryName }).click();
    await page.getByLabel(v.remarks).fill("Will pay at the counter");
    await page.getByRole("radio", { name: new RegExp(v.outcome.PURCHASED.label) }).click();
    await page.getByRole("button", { name: v.nextBill }).click();

    await expect(page).toHaveURL(new RegExp(`/sales/new\\?customerId=${customer.id}&draft=`));
    expect(await db.visit.count({ where: { customerId: customer.id } })).toBe(0);

    // Back: the form is as it was left.
    await page.goBack();
    await expect(page.getByLabel(v.remarks)).toHaveValue("Will pay at the counter");
    await expect(page.getByRole("button", { name: v.nextBill })).toBeEnabled();

    // Log out and back in on the same tab: the draft is gone (SOW M19 "Data kept on the
    // phone is cleared on log out").
    await page.getByRole("button", { name: en.auth.logOut }).click();
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, sales.mobile, "SALESPERSON");
    await page.goto(`/visits/new?customerId=${customer.id}`);
    await expect(page.getByLabel(v.remarks)).toHaveValue("");
    await expect(page.getByRole("button", { name: v.chooseAnswer })).toBeDisabled();
  });

  test("a visit is filed under the branch it happened in, whoever's customer it is", async ({
    page,
  }) => {
    const branchB = await db.branch.create({
      data: {
        name: `E2E Visit Branch ${tag}`,
        address: "1 Ring Road",
        city: "Surat",
        phone: "0261 123 4567",
      },
    });
    branches.push(branchB.id);
    const owner = await makeStaff("SALESPERSON", "E2E Branch A Owner");
    const visitor = await makeStaff("SALESPERSON", "E2E Branch B Seller", branchB.id);
    users.push(owner.id, visitor.id);
    const customer = await customerOf(owner, "Travelling Customer");
    await signIn(page, visitor.mobile, "SALESPERSON");

    await page.goto(`/visits/new?customerId=${customer.id}`);
    await page.getByRole("button", { name: categoryName }).click();
    await page.getByRole("radio", { name: new RegExp(v.outcome.NOT_INTERESTED.label) }).click();
    await page.getByRole("radio", { name: reasonName }).click();
    await page.getByRole("button", { name: v.saveAndClose }).click();
    await expect(page).toHaveURL(/\/today/);

    const visit = await db.visit.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(visit.branchId).toBe(branchB.id);
    expect(visit.salespersonId).toBe(visitor.id);
  });
});
