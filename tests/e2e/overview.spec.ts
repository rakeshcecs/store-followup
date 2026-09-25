import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M12: the Store overview a manager lands on — tiles, the salesperson table, the alerts
// and the period picker — on a branch of its own so the numbers are exactly this test's.

test.describe("store overview", () => {
  const users: string[] = [];
  const customers: string[] = [];
  const branches: string[] = [];

  test.afterAll(async () => {
    // Test rows only; the app itself never hard-deletes (CLAUDE.md).
    await db.sale.deleteMany({ where: { customerId: { in: customers } } });
    await db.visit.deleteMany({ where: { customerId: { in: customers } } });
    await db.followUp.deleteMany({ where: { customerId: { in: customers } } });
    await db.enquiry.deleteMany({ where: { customerId: { in: customers } } });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  async function shop() {
    const today = isoDate(new Date());
    const branch = await db.branch.create({
      data: {
        name: `E2E Overview ${randomUUID().slice(0, 6)}`,
        address: "1 Test Road",
        city: "Surat",
        phone: "9825012345",
      },
    });
    branches.push(branch.id);
    const manager = await makeStaff("MANAGER", "E2E Overview Manager", branch.id);
    const seller = await makeStaff("SALESPERSON", "E2E Overview Seller", branch.id);
    users.push(manager.id, seller.id);

    const customer = async (name: string) => {
      const c = await db.customer.create({
        data: { name, mobile: randomMobile(), assignedToId: seller.id, homeBranchId: branch.id },
      });
      customers.push(c.id);
      const e = await db.enquiry.create({
        data: { customerId: c.id, assignedToId: seller.id, title: "Wedding" },
      });
      return { customerId: c.id, enquiryId: e.id, branchId: branch.id };
    };

    // Today: one new visitor who bought (a follow-up conversion). Five days ago: a
    // follow-up nobody made — overdue, and more than 3 days late.
    const buyer = await customer("E2E Overview Buyer");
    await db.visit.create({
      data: {
        ...buyer,
        clientId: randomUUID(),
        visitAt: new Date(),
        salespersonId: seller.id,
        outcome: "PURCHASED",
        visitType: "NEW",
      },
    });
    await db.sale.create({
      data: {
        ...buyer,
        clientId: randomUUID(),
        billNumber: `OV-${randomUUID().slice(0, 8)}`,
        billDate: calendarDay(today),
        salespersonId: seller.id,
        fromFollowUp: true,
      },
    });
    const late = await customer("E2E Overview Late");
    const followUp = await db.followUp.create({
      data: {
        ...late,
        clientId: randomUUID(),
        dueDate: calendarDay(addDays(today, -5)),
        timeSlot: "EVENING",
        method: "CALL",
        assignedToId: seller.id,
        createdFrom: "VISIT",
      },
    });
    return { manager, seller, followUp };
  }

  test("the manager's numbers, table and alerts, and the period picker", async ({ page }) => {
    const { manager, seller, followUp } = await shop();
    await signIn(page, manager.mobile, "MANAGER");
    await expect(page.getByRole("heading", { name: en.overview.title })).toBeVisible();

    await expect(page.getByTestId("tile-visited-value")).toHaveText("1");
    await expect(page.getByTestId("tile-visited")).toContainText("1 new, 0 existing");
    await expect(page.getByTestId("tile-sales-value")).toHaveText("1");
    await expect(page.getByTestId("tile-sales")).toContainText("1 came from follow-ups");
    await expect(page.getByTestId("tile-overdue-value")).toHaveText("1");
    await expect(page.getByTestId("tile-due-value")).toHaveText("0");

    const row = page.getByTestId("person-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("E2E Overview Seller");

    const alert = page.getByTestId("alert-long-overdue");
    await expect(alert).toContainText("1 follow-up overdue by more than 3 days");
    await expect(alert).toContainText("E2E Overview Late");

    // The period is in the address.
    await page.getByLabel(en.overview.period.label).selectOption("week");
    await expect(page).toHaveURL(/period=week/);
    await expect(page.getByTestId("tile-sales-value")).toHaveText("1");

    // Custom dates: the day before yesterday alone has nothing.
    await page.getByLabel(en.overview.period.label).selectOption("custom");
    const day = addDays(isoDate(new Date()), -2);
    await page.getByLabel(en.overview.period.from, { exact: true }).fill(day);
    await page.getByLabel(en.overview.period.to, { exact: true }).fill(day);
    await page.getByRole("button", { name: en.overview.period.show }).click();
    await expect(page).toHaveURL(new RegExp(`period=custom&from=${day}&to=${day}`));
    await expect(page.getByTestId("tile-sales-value")).toHaveText("0");
    // Overdue is always as of now.
    await expect(page.getByTestId("tile-overdue-value")).toHaveText("1");

    // A name opens that salesperson's follow-ups; an alert opens the follow-up.
    await row.getByRole("link", { name: "E2E Overview Seller" }).click();
    await expect(page).toHaveURL(new RegExp(`/follow-ups\\?assignedTo=${seller.id}`));
    await page.goBack();
    await page.getByTestId("alert-long-overdue").getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/follow-ups/${followUp.id}$`));
  });

  test("a salesperson cannot open it", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Overview Outsider");
    users.push(sales.id);
    await signIn(page, sales.mobile, "SALESPERSON");
    expect((await page.goto("/overview"))?.status()).toBe(404);
  });
});
