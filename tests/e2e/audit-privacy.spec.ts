import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M16: the audit log a manager reads from the reports list, and the admin's privacy
// delete on the customer profile.

test.describe("audit and privacy", () => {
  const users: string[] = [];
  const customers: string[] = [];
  const branches: string[] = [];

  test.afterAll(async () => {
    // Test rows only; the app itself never hard-deletes (CLAUDE.md).
    await db.timelineEvent.deleteMany({ where: { customerId: { in: customers } } });
    await db.sale.deleteMany({ where: { customerId: { in: customers } } });
    await db.followUp.deleteMany({ where: { customerId: { in: customers } } });
    await db.enquiry.deleteMany({ where: { customerId: { in: customers } } });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  async function shop() {
    const branch = await db.branch.create({
      data: {
        name: `E2E Audit ${randomUUID().slice(0, 6)}`,
        address: "1 Test Road",
        city: "Surat",
        phone: "9825012345",
      },
    });
    branches.push(branch.id);
    return branch.id;
  }

  test("a manager finds a cancelled sale in the audit log by its bill number", async ({ page }) => {
    const branchId = await shop();
    const manager = await makeStaff("MANAGER", "E2E Audit Manager", branchId);
    const seller = await makeStaff("SALESPERSON", "E2E Audit Seller", branchId);
    users.push(manager.id, seller.id);
    const customer = await db.customer.create({
      data: {
        name: "E2E Audit Customer",
        mobile: randomMobile(),
        assignedToId: seller.id,
        homeBranchId: branchId,
      },
    });
    customers.push(customer.id);
    const enquiry = await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: seller.id, title: "Wedding" },
    });
    const bill = `E2E-${randomUUID().slice(0, 6)}`.toUpperCase();
    const sale = await db.sale.create({
      data: {
        branchId,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        billNumber: bill,
        billDate: new Date(),
        billAmount: 1500,
        salespersonId: seller.id,
      },
    });
    await db.auditLog.create({
      data: {
        userId: manager.id,
        branchId,
        action: "sale:cancel",
        entityType: "Sale",
        entityId: sale.id,
        oldValue: { cancelled: false },
        newValue: { cancelled: true, reason: "Returned" },
      },
    });

    await signIn(page, manager.mobile, "MANAGER");
    await page.goto("/reports");
    await page.locator('a[href="/audit"]').click();
    await expect(page.getByRole("heading", { name: en.audit.title })).toBeVisible();

    const filters = page.getByTestId("audit-filters");
    await filters.getByLabel(en.audit.filters.q, { exact: true }).fill(bill);
    await filters.getByRole("button", { name: en.audit.filters.show }).click();
    await expect(page).toHaveURL(new RegExp(`q=${bill}`));

    const row = page.getByTestId("audit-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(en.audit.actions.sale_cancel);
    await expect(row).toContainText("E2E Audit Customer");
    await expect(row).toContainText("By E2E Audit Manager");
    await row.getByText("2 changes").click();
    await expect(row).toContainText("Returned");
    // The row opens the customer it is about.
    await row.getByRole("link", { name: /E2E Audit Customer/ }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
  });

  test("a salesperson cannot open the audit log", async ({ page }) => {
    const seller = await makeStaff("SALESPERSON", "E2E Audit Outsider");
    users.push(seller.id);
    await signIn(page, seller.mobile, "SALESPERSON");
    expect((await page.goto("/audit"))?.status()).toBe(404);
  });

  test("the admin deletes a customer's data, who then cannot be found", async ({ page }) => {
    const branchId = await shop();
    const admin = await makeStaff("ADMIN", "E2E Privacy Admin", branchId);
    const manager = await makeStaff("MANAGER", "E2E Privacy Manager", branchId);
    users.push(admin.id, manager.id);
    const mobile = randomMobile();
    const customer = await db.customer.create({
      data: {
        name: "E2E Forget Me",
        mobile,
        assignedToId: manager.id,
        homeBranchId: branchId,
        consentGiven: true,
        consentAt: new Date(),
        consentById: manager.id,
      },
    });
    customers.push(customer.id);

    // A manager sees the consent but not the delete.
    await signIn(page, manager.mobile, "MANAGER");
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByTestId("consent")).toContainText("recorded by E2E Privacy Manager");
    await expect(page.getByRole("link", { name: en.customers.profile.deleteData })).toHaveCount(0);
    expect((await page.goto(`/customers/${customer.id}/delete-data`))?.status()).toBe(404);
    await page.context().clearCookies(); // the 404 page has no log-out button

    await signIn(page, admin.mobile, "ADMIN");
    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("link", { name: en.customers.profile.deleteData }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}/delete-data$`));

    const digits = page.getByLabel(en.privacy.lastFour);
    await digits.fill(mobile.slice(-4) === "0000" ? "1111" : "0000");
    await page.getByRole("button", { name: en.privacy.submit }).click();
    await page.getByRole("button", { name: en.privacy.confirm }).click();
    await expect(page.getByText(en.privacy.errors.lastFourWrong)).toBeVisible();

    await digits.fill(mobile.slice(-4));
    await page.getByRole("button", { name: en.privacy.submit }).click();
    await expect(page.getByRole("alertdialog")).toContainText("E2E Forget Me");
    await page.getByRole("button", { name: en.privacy.confirm }).click();
    await expect(page).toHaveURL(/\/customers$/);

    // Gone from search, and the profile is gone with it.
    await page.goto(`/customers?mobile=${mobile}`);
    await expect(page.getByText("E2E Forget Me")).toHaveCount(0);
    expect((await page.goto(`/customers/${customer.id}`))?.status()).toBe(404);

    // Who did it is in the audit log.
    await page.goto("/audit?kind=DELETE");
    await expect(page.getByTestId("audit-row").first()).toContainText(
      en.audit.actions.customer_anonymize,
    );
    await expect(page.getByTestId("audit-row").first()).toContainText("By E2E Privacy Admin");
  });
});
