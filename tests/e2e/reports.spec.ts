import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M13: reports from the Store overview, filters and sorting, the Excel and PDF files and
// their audit rows — and a salesperson who sees only their own two.

test.describe("reports", () => {
  const users: string[] = [];
  const customers: string[] = [];
  const branches: string[] = [];

  test.afterAll(async () => {
    // Test rows only; the app itself never hard-deletes (CLAUDE.md).
    await db.sale.deleteMany({ where: { customerId: { in: customers } } });
    await db.visit.deleteMany({ where: { customerId: { in: customers } } });
    await db.enquiry.deleteMany({ where: { customerId: { in: customers } } });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  // A branch of its own with two visits today: one bought, one not interested.
  async function shop() {
    const branch = await db.branch.create({
      data: {
        name: `E2E Reports ${randomUUID().slice(0, 6)}`,
        address: "1 Test Road",
        city: "Surat",
        phone: "9825012345",
      },
    });
    branches.push(branch.id);
    const manager = await makeStaff("MANAGER", "E2E Reports Manager", branch.id);
    const seller = await makeStaff("SALESPERSON", "E2E Reports Seller", branch.id);
    const other = await makeStaff("SALESPERSON", "E2E Reports Other", branch.id);
    users.push(manager.id, seller.id, other.id);
    for (const [name, outcome] of [
      ["E2E Report Buyer", "PURCHASED"],
      ["E2E Report Browser", "DECIDE_LATER"],
    ] as const) {
      const c = await db.customer.create({
        data: { name, mobile: randomMobile(), assignedToId: seller.id, homeBranchId: branch.id },
      });
      customers.push(c.id);
      const e = await db.enquiry.create({
        data: { customerId: c.id, assignedToId: seller.id, title: "Wedding" },
      });
      await db.visit.create({
        data: {
          branchId: branch.id,
          customerId: c.id,
          enquiryId: e.id,
          clientId: randomUUID(),
          visitAt: new Date(),
          salespersonId: seller.id,
          outcome,
          visitType: "NEW",
        },
      });
      if (outcome === "PURCHASED") {
        await db.sale.create({
          data: {
            branchId: branch.id,
            customerId: c.id,
            enquiryId: e.id,
            clientId: randomUUID(),
            billNumber: `E2E-${randomUUID().slice(0, 8)}`,
            billDate: calendarDay(isoDate(new Date())),
            billAmount: 4500,
            salespersonId: seller.id,
          },
        });
      }
    }
    return { manager, seller, other };
  }

  test("a manager opens a report, filters, sorts and exports it", async ({ page }) => {
    const { manager } = await shop();
    await signIn(page, manager.mobile, "MANAGER");

    // From the Store overview's list (M12.05); R9 is the admin's.
    await expect(page.locator(`a[href="/reports/r9"]`)).toHaveCount(0);
    await page.locator(`a[href="/reports/r1"]`).click();
    await expect(page).toHaveURL(/\/reports\/r1$/);
    await expect(page.getByTestId("report-row")).toHaveCount(2);
    await expect(page.getByTestId("totals-row")).toContainText("2 visits, 2 customers");

    await page
      .getByTestId("report-filters")
      .getByLabel(en.reports.filters.outcome, { exact: true })
      .selectOption("PURCHASED");
    await page.getByRole("button", { name: en.reports.filters.show }).click();
    await expect(page).toHaveURL(/outcome=PURCHASED/);
    await expect(page.getByTestId("report-row")).toHaveCount(1);
    await expect(page.getByTestId("report-row")).toContainText("E2E Report Buyer");

    // Sort by any column, keeping the filter.
    await page.getByRole("link", { name: "Sort by Customer" }).click();
    await expect(page).toHaveURL(
      /outcome=PURCHASED.*sort=customer|sort=customer.*outcome=PURCHASED/,
    );

    // Excel: a real .xlsx with the store, the report and a date cell.
    const [xlsx] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: en.reports.excel }).click(),
    ]);
    expect(xlsx.suggestedFilename()).toMatch(/^r1-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const book = new ExcelJS.Workbook();
    const file = await readFile((await xlsx.path())!);
    await book.xlsx.load(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    );
    const sheet = book.worksheets[0]!;
    expect(sheet.getCell("A2").value).toBe(en.reports.names.r1);
    const values = sheet.getSheetValues().flat().map(String);
    expect(values).toContain("E2E Report Buyer");
    expect(values).not.toContain("E2E Report Browser"); // the filter went with it

    // PDF.
    const [pdf] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: en.reports.pdf }).click(),
    ]);
    const head = (await readFile((await pdf.path())!)).subarray(0, 5).toString();
    expect(head).toBe("%PDF-");

    // Each export is in the audit log.
    const audits = await db.auditLog.findMany({
      where: { userId: manager.id, action: "report:export" },
      select: { entityId: true, newValue: true },
    });
    expect(audits).toHaveLength(2);
    expect(audits.map((row) => (row.newValue as { format: string }).format).sort()).toEqual([
      "pdf",
      "xlsx",
    ]);
  });

  test("a salesperson sees only their own two reports, and cannot export", async ({ page }) => {
    const { seller } = await shop();
    await signIn(page, seller.mobile, "SALESPERSON");
    await page.goto("/profile");
    await page.getByRole("link", { name: en.reports.myTitle }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.locator(`a[href="/reports/r2"]`)).toBeVisible();
    await expect(page.locator(`a[href="/reports/r3"]`)).toBeVisible();
    await expect(page.locator(`a[href="/reports/r1"]`)).toHaveCount(0);

    await page.locator(`a[href="/reports/r2"]`).click();
    const rows = page.getByTestId("report-row");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("E2E Reports Seller");
    await expect(page.getByRole("link", { name: en.reports.excel })).toHaveCount(0);

    expect((await page.goto("/reports/r1"))?.status()).toBe(404);
    expect((await page.goto("/reports/r2/export?format=xlsx"))?.status()).toBe(404);
  });
});
