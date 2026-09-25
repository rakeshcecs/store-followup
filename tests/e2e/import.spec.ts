import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { runImport } from "@/lib/import/run";
import { IMPORT_COLUMNS } from "@/lib/import/types";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M24: a manager downloads the template, uploads a filled one, checks the preview,
// confirms, and gets the result file. The worker's run is called directly here — the
// e2e server has no worker process.

test.describe("customer import", () => {
  const users: string[] = [];
  const branches: string[] = [];
  const mobiles: string[] = [];

  test.afterAll(async () => {
    const customers = (
      await db.customer.findMany({ where: { mobile: { in: mobiles } }, select: { id: true } })
    ).map((c) => c.id);
    await db.timelineEvent.deleteMany({ where: { customerId: { in: customers } } });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.job.deleteMany({
      where: { singletonKey: { startsWith: "customer-import:" }, status: "PENDING" },
    });
    await db.importJob.deleteMany({ where: { branchId: { in: branches } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  async function shop() {
    const branch = await db.branch.create({
      data: {
        name: `E2E Import ${randomUUID().slice(0, 6)}`,
        address: "1 Test Road",
        city: "Surat",
        phone: "9825012345",
      },
    });
    branches.push(branch.id);
    return branch.id;
  }

  async function file(rows: (string | null)[][]): Promise<Buffer> {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Customers");
    sheet.addRow(IMPORT_COLUMNS.map((c) => en.import.columns[c]));
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  test("a manager imports a file from the template to the result", async ({ page }) => {
    const branchId = await shop();
    const manager = await makeStaff("MANAGER", "E2E Import Manager", branchId);
    const seller = await makeStaff("SALESPERSON", "E2E Import Seller", branchId);
    users.push(manager.id, seller.id);
    const existing = await db.customer.create({
      data: {
        name: "E2E Already Here",
        mobile: randomMobile(),
        assignedToId: seller.id,
        homeBranchId: branchId,
      },
    });
    const [a, b] = [randomMobile(), randomMobile()];
    mobiles.push(a, b, existing.mobile!);

    await signIn(page, manager.mobile, "MANAGER");
    await page.goto("/reports");
    await page.locator('a[href="/import"]').click();
    await expect(page.getByRole("heading", { name: en.import.title })).toBeVisible();

    // The template, headings in the reader's language.
    const [template] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: en.import.template.download }).click(),
    ]);
    const book = new ExcelJS.Workbook();
    const bytes = await readFile((await template.path())!);
    await book.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    expect((book.worksheets[0]!.getRow(1).values as string[]).slice(1)).toEqual(
      IMPORT_COLUMNS.map((c) => en.import.columns[c]),
    );

    // Upload: two good rows, one mistake, one existing customer.
    await page.getByLabel(en.import.file, { exact: true }).setInputFiles({
      name: "shop-list.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await file([
        [
          "E2E Imported One",
          a,
          null,
          "Adajan",
          "Surat",
          null,
          "Wedding",
          "05-12-2026",
          seller.mobile,
          "Yes",
        ],
        ["E2E Imported Two", b, null, null, null, null, null, null, "9899999999", null],
        ["E2E Broken", "12345", null, null, null, null, null, null, null, null],
        [
          "E2E Existing Again",
          existing.mobile,
          null,
          "New Area",
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      ]),
    });
    await page.getByRole("button", { name: en.import.check }).click();
    await expect(page).toHaveURL(/\/import\/[^/]+$/);
    await expect(page.getByTestId("tab-ready")).toHaveText("Ready (2)");
    await expect(page.getByTestId("tab-error")).toHaveText("Has mistakes (1)");
    await expect(page.getByTestId("tab-exists")).toHaveText("Already exists (1)");
    await expect(page.getByTestId("preview-row")).toHaveCount(2);
    // The table keeps its height on a phone, where the page is taller than the screen.
    expect((await page.locator("table").boundingBox())!.height).toBeGreaterThan(80);
    await expect(page.getByTestId("preview-row").nth(1)).toContainText(
      "No salesperson with mobile 9899999999",
    );
    await page.getByTestId("tab-error").click();
    await expect(page).toHaveURL(/tab=error/);
    await expect(page.getByTestId("preview-row")).toHaveCount(1);
    await expect(page.getByTestId("preview-row")).toContainText("Mobile must be 10 digits");

    // Update the existing one's empty fields; confirm WhatsApp.
    await expect(page.getByRole("button", { name: "Import 2 customers" })).toBeVisible();
    await page.getByLabel(en.import.existingUpdate).check();
    await expect(page.getByRole("button", { name: "Import 3 customers" })).toBeVisible();
    await page.getByLabel(en.import.whatsappConfirm).check();
    await page.getByRole("button", { name: "Import 3 customers" }).click();
    await expect(page.getByText(en.import.running).first()).toBeVisible();

    // The worker's turn.
    const jobId = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(await runImport(jobId)).toBe(true);
    await expect(page.getByTestId("import-result")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("count-imported")).toContainText("2");
    await expect(page.getByTestId("count-updated")).toContainText("1");
    await expect(page.getByTestId("count-mistakes")).toContainText("1");

    // The result file: the mistake and the note, with reasons.
    const [result] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: en.import.resultFile }).click(),
    ]);
    const out = new ExcelJS.Workbook();
    const outBytes = await readFile((await result.path())!);
    await out.xlsx.load(
      outBytes.buffer.slice(
        outBytes.byteOffset,
        outBytes.byteOffset + outBytes.byteLength,
      ) as ArrayBuffer,
    );
    const values = out.worksheets[0]!.getSheetValues().flat().map(String);
    expect(values).toContain("E2E Broken");
    expect(values.some((v) => v.startsWith("Mobile must be 10 digits"))).toBe(true);
    expect(values).toContain("E2E Imported Two");

    // In the database, and on the profile: "Imported on … by …".
    const one = await db.customer.findUniqueOrThrow({ where: { mobile: a } });
    expect(one).toMatchObject({
      source: "IMPORT",
      homeBranchId: branchId,
      assignedToId: seller.id,
      whatsappConsent: true,
    });
    expect((await db.customer.findUniqueOrThrow({ where: { id: existing.id } })).area).toBe(
      "New Area",
    );
    await page.goto(`/customers/${one.id}`);
    await expect(page.getByText(/Imported on .* by E2E Import Manager/)).toBeVisible();

    // And in the list of earlier imports.
    await page.goto("/import");
    await expect(page.getByTestId("import-history-row").first()).toContainText("shop-list.xlsx");
    await expect(page.getByTestId("import-history-row").first()).toContainText(
      "2 imported, 1 updated, 1 not imported",
    );
  });

  test("a wrong file is refused with the reason, and a preview can be discarded", async ({
    page,
  }) => {
    const branchId = await shop();
    const manager = await makeStaff("MANAGER", "E2E Import Discarder", branchId);
    users.push(manager.id);
    await signIn(page, manager.mobile, "MANAGER");
    await page.goto("/import");
    await page.getByLabel(en.import.file, { exact: true }).setInputFiles({
      name: "notes.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await (async () => {
        const book = new ExcelJS.Workbook();
        book.addWorksheet("x").addRow(["Something", "Else"]);
        return Buffer.from(await book.xlsx.writeBuffer());
      })(),
    });
    await page.getByRole("button", { name: en.import.check }).click();
    await expect(page.getByText(en.import.errors.headings)).toBeVisible();

    const c = randomMobile();
    mobiles.push(c);
    await page.getByLabel(en.import.file, { exact: true }).setInputFiles({
      name: "keep-out.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await file([["E2E Discard Me", c, null, null, null, null, null, null, null, null]]),
    });
    await page.getByRole("button", { name: en.import.check }).click();
    await expect(page).toHaveURL(/\/import\/[^/]+$/);
    await page.getByRole("button", { name: en.import.discard }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: en.import.discard }).click();
    await expect(page).toHaveURL(/\/import$/);
    expect(await db.customer.count({ where: { mobile: c } })).toBe(0);
  });

  test("a salesperson cannot import, and a manager cannot open another branch's import", async ({
    page,
  }) => {
    const branchId = await shop();
    const otherBranch = await shop();
    const seller = await makeStaff("SALESPERSON", "E2E Import Outsider", branchId);
    const managerB = await makeStaff("MANAGER", "E2E Import Other Manager", otherBranch);
    const managerA = await makeStaff("MANAGER", "E2E Import Owner", branchId);
    users.push(seller.id, managerB.id, managerA.id);
    const job = await db.importJob.create({
      data: { branchId, fileName: "a.xlsx", uploadedById: managerA.id, totalRows: 0 },
    });

    await signIn(page, seller.mobile, "SALESPERSON");
    for (const url of ["/import", "/import/template", `/import/${job.id}`])
      expect((await page.request.get(url)).status(), url).toBe(404);
    expect((await page.request.post("/import/upload", { multipart: { branchId } })).status()).toBe(
      404,
    );
    await page.context().clearCookies();

    await signIn(page, managerB.mobile, "MANAGER");
    expect((await page.request.get(`/import/${job.id}`)).status()).toBe(404);
    // Uploading into someone else's branch is refused.
    const upload = await page.request.post("/import/upload", {
      multipart: {
        branchId,
        file: {
          name: "x.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("Name*,Mobile*\nA,9825012345"),
        },
      },
    });
    expect(upload.status()).toBe(400);
    expect(await upload.json()).toEqual({ ok: false, error: "import.errors.branch" });
  });
});
