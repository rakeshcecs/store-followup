import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// The worker's campaign job, run once for one campaign. Through tsx in a child process,
// as `npm run worker` runs it: the library imports the message files as JSON, which
// Playwright's own loader refuses.
function workerRuns(campaignId: string): number | null {
  const out = execFileSync("npx", ["tsx", "tests/e2e/run-campaign.ts", campaignId], {
    shell: true,
    encoding: "utf8",
    timeout: 120_000,
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith("RESULT="));
  return line ? (JSON.parse(line.slice("RESULT=".length)) as number | null) : null;
}

// M23 in the browser: the admin's festival calendar and occasion settings; a manager
// builds a campaign for their own branch — message, customers, the preview counts, a
// schedule — then cancels it, sends another now and reads its results after the worker
// (run here directly, the worker is not running) has queued the messages. A salesperson
// gets 404 everywhere.
//
// Its own branch, so the preview's numbers are exact whatever other specs create.

test.describe("campaigns and festivals", () => {
  const tag = randomUUID().slice(0, 6);
  const users: string[] = [];
  const customers: string[] = [];
  const templates: string[] = [];
  const branches: string[] = [];

  test.afterAll(async () => {
    const campaigns = await db.campaign.findMany({
      where: { name: { contains: tag } },
      select: { id: true },
    });
    const campaignIds = campaigns.map((c) => c.id);
    await db.whatsAppMessage.deleteMany({ where: { customerId: { in: customers } } });
    await db.timelineEvent.deleteMany({ where: { customerId: { in: customers } } });
    await db.job.deleteMany({
      where: { singletonKey: { in: campaignIds.map((id) => `campaign-send:${id}`) } },
    });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    // Also whatever the pre-fill button added under this spec's admin.
    await db.festival.deleteMany({
      where: { OR: [{ name: { contains: tag } }, { createdById: { in: users } }] },
    });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.whatsAppTemplate.deleteMany({ where: { id: { in: templates } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  async function shop() {
    const branch = await db.branch.create({
      data: {
        name: `E2E Campaign ${tag}-${randomUUID().slice(0, 4)}`,
        address: "1 Test Road",
        city: "Surat",
        phone: "9825012345",
      },
    });
    branches.push(branch.id);
    const manager = await makeStaff("MANAGER", "E2E Campaign Manager", branch.id);
    const seller = await makeStaff("SALESPERSON", "E2E Campaign Seller", branch.id);
    users.push(manager.id, seller.id);
    for (const [name, consent] of [
      ["Asha Campaign", true],
      ["Bina Campaign", true],
      ["Chirag Campaign", false],
    ] as const) {
      const customer = await db.customer.create({
        data: {
          name,
          mobile: randomMobile(),
          assignedToId: seller.id,
          homeBranchId: branch.id,
          whatsappConsent: consent,
          whatsappConsentAt: consent ? new Date() : null,
        },
      });
      customers.push(customer.id);
    }
    const template = await db.whatsAppTemplate.create({
      data: {
        name: `e2e_offer_${tag}_${randomUUID().slice(0, 4)}`,
        language: "en",
        metaLanguage: "en_US",
        category: "MARKETING",
        body: "Hello {{1}}, {{2}}",
        variables: ["1", "2"],
        // Fully mapped, so it is usable on every customer's WhatsApp page too (the
        // whatsapp spec counts the unusable ones there).
        mapping: { "1": "customerFirstName", "2": "storeName" },
        metaStatus: "APPROVED",
      },
    });
    templates.push(template.id);
    return { branch, manager, seller, template };
  }

  test("the admin keeps the festival calendar and the occasion settings", async ({ page }) => {
    test.slow(); // five saves in a row, then the pre-fill of two years of festivals
    const admin = await makeStaff("ADMIN", "E2E Festival Admin");
    users.push(admin.id);
    await signIn(page, admin.mobile, "ADMIN");
    await page.goto("/settings");
    await page.getByRole("link", { name: new RegExp(en.settings.festivals) }).click();
    await expect(page).toHaveURL(/\/settings\/festivals$/);
    expect(await page.evaluate(() => window.innerWidth <= screen.width)).toBe(true);

    const f = en.festivals;
    // The settings save (the defaults again, so parallel specs see no change).
    await page.getByLabel(f.leadDays).fill("30");
    await page.getByLabel(f.weeklyLimit).fill("2");
    await page.getByRole("button", { name: f.save }).first().click();
    await expect(page.getByText(f.saved).first()).toBeVisible();

    // Add one, see it confirmed, edit its date, remove it.
    const name = `E2E Mela ${tag}`;
    await page.getByRole("button", { name: f.add }).click();
    const add = page.getByTestId("festival-add");
    await add.getByLabel(f.name).fill(name);
    await add.getByLabel(f.date).fill("2027-02-14");
    await add.getByRole("button", { name: f.save }).click();
    const row = page.getByTestId("festival-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByTestId("festival-confirmed")).toHaveText(f.confirmed);
    await expect(row).toContainText("14 Feb 2027");
    await row.getByRole("button", { name: f.edit }).click();
    await row.getByLabel(f.date).fill("2027-02-15");
    await row.getByRole("button", { name: f.save }).click();
    await expect(row).toContainText("15 Feb 2027");
    // On a phone the "Saved" toast sits over this row's buttons, and a pointer resting on
    // a toast keeps it open, so let it go first, as a person would.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await row.getByRole("button", { name: f.remove }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: f.removeConfirm }).click();
    await expect(page.getByTestId("festival-row").filter({ hasText: name })).toHaveCount(0);
    const stored = await db.festival.findFirstOrThrow({ where: { name } });
    expect(stored.active).toBe(false);

    // The pre-fill button answers with a count and never doubles what is there.
    const prefill = page.getByRole("button", { name: /common festivals/ });
    if (await prefill.isVisible()) {
      await prefill.click();
      await expect(page.getByText(/festival(s)? added|Nothing new to add/)).toBeVisible();
      const diwali = await db.festival.count({
        where: { name: "Diwali", active: true, branchId: null, date: new Date("2026-11-08") },
      });
      expect(diwali).toBeLessThanOrEqual(1);
    }
  });

  test("a manager builds a campaign for their branch, sees who gets it, schedules, cancels; sends one now and reads the results", async ({
    page,
  }) => {
    // Two campaigns built end to end plus two worker runs: three times the usual budget.
    test.slow();
    const { manager, template } = await shop();
    const c = en.campaigns;
    await signIn(page, manager.mobile, "MANAGER");
    await page.goto("/reports");
    await page.getByRole("link", { name: new RegExp(c.title) }).click();
    await expect(page).toHaveURL(/\/campaigns$/);
    await page.getByRole("link", { name: c.new }).click();
    await expect(page).toHaveURL(/\/campaigns\/new$/);
    expect(await page.evaluate(() => window.innerWidth <= screen.width)).toBe(true);

    const name = `Diwali ${tag}`;
    await page.getByLabel(c.name).fill(name);
    await page.getByRole("radio", { name: new RegExp(template.name) }).click();
    // Both placeholders came pre-filled from the admin's mapping; 2 becomes a fixed text.
    const variables = page.getByTestId("campaign-variable");
    await expect(variables).toHaveCount(2);
    await expect(page.getByTestId("message-preview")).toContainText(
      "Hello «Customer first name», «Store name»",
    );
    await variables.nth(1).getByRole("combobox").selectOption({ label: c.sameText });
    await variables.nth(1).getByLabel(c.text).fill("20% off till Sunday");
    await expect(page.getByTestId("message-preview")).toContainText(
      "Hello «Customer first name», 20% off till Sunday",
    );

    // Nothing sends until the preview has been looked at.
    await expect(page.getByRole("button", { name: c.confirmNow })).toBeDisabled();
    await page.getByRole("button", { name: c.check }).click();
    await expect(page.getByTestId("preview-counts")).toContainText("3 customers match.");
    await expect(page.getByTestId("preview-counts")).toContainText(
      "1 skipped (no WhatsApp consent).",
    );
    await expect(page.getByTestId("preview-counts")).toContainText("0 skipped (weekly limit).");
    await expect(page.getByTestId("preview-ready")).toHaveText("2 customers will get it.");
    await expect(page.getByTestId("preview-sample")).toHaveCount(2);

    // A change makes the preview stale again.
    await page.getByLabel(c.filters.occasionWithin).fill("10");
    await expect(page.getByTestId("preview-stale")).toBeVisible();
    await page.getByLabel(c.filters.occasionWithin).fill("");
    await expect(page.getByTestId("preview-stale")).toHaveCount(0);

    // Schedule for tomorrow 10:30.
    await page.getByRole("radio", { name: c.when.later }).click();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel(c.scheduledAt).fill(`${tomorrow}T10:30`);
    await page.getByRole("button", { name: c.confirm }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`2 customers will get "${name}"`);
    await dialog.getByRole("button", { name: c.confirm }).click();
    // Not /campaigns/new any more: the campaign's own page, with its status pill.
    await expect(page).toHaveURL(/\/campaigns\/(?!new$)[a-z0-9]+$/);
    await expect(page.getByTestId("campaign-status")).toHaveText(c.status.SCHEDULED);
    const scheduled = await db.campaign.findFirstOrThrow({ where: { name } });
    expect(scheduled.status).toBe("SCHEDULED");
    expect(await db.job.count({ where: { singletonKey: `campaign-send:${scheduled.id}` } })).toBe(
      1,
    );

    // Cancelled before it starts: nothing goes out.
    await page.getByTestId("cancel-campaign").click();
    await page.getByRole("alertdialog").getByRole("button", { name: c.cancelConfirm }).click();
    await expect(page.getByTestId("campaign-status")).toHaveText(c.status.CANCELLED);
    await expect(page.getByTestId("cancel-campaign")).toHaveCount(0);
    expect(workerRuns(scheduled.id)).toBeNull();
    expect(await db.whatsAppMessage.count({ where: { campaignId: scheduled.id } })).toBe(0);

    // Send now: the worker (run here) queues one message per consenting customer.
    await page.goto("/campaigns/new");
    const nowName = `Offer now ${tag}`;
    await page.getByLabel(c.name).fill(nowName);
    await page.getByRole("radio", { name: new RegExp(template.name) }).click();
    const second = page.getByTestId("campaign-variable").nth(1);
    await second.getByRole("combobox").selectOption({ label: c.sameText });
    await second.getByLabel(c.text).fill("visit us today");
    await page.getByRole("button", { name: c.check }).click();
    await expect(page.getByTestId("preview-ready")).toHaveText("2 customers will get it.");
    await page.getByRole("button", { name: c.confirmNow }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: c.confirmNow }).click();
    await expect(page).toHaveURL(/\/campaigns\/(?!new$)[a-z0-9]+$/);
    await expect(page.getByTestId("campaign-status")).toHaveText(c.status.SCHEDULED);
    const sendNow = await db.campaign.findFirstOrThrow({ where: { name: nowName } });
    expect(workerRuns(sendNow.id)).toBe(2);
    const messages = await db.whatsAppMessage.findMany({ where: { campaignId: sendNow.id } });
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.body).sort()).toEqual([
      "Hello Asha, visit us today",
      "Hello Bina, visit us today",
    ]);
    expect(messages.every((m) => m.kind === "CAMPAIGN" && m.status === "QUEUED")).toBe(true);
    // Meta's ticks arrive (webhook, M22) — here written directly; the page counts them.
    await db.whatsAppMessage.update({ where: { id: messages[0]!.id }, data: { status: "READ" } });
    await page.reload();
    await expect(page.getByTestId("campaign-status")).toHaveText(c.status.DONE);
    await expect(page.getByTestId("result-recipients")).toContainText("2");
    await expect(page.getByTestId("result-read")).toContainText("1");
    await expect(page.getByTestId("recipient-row")).toHaveCount(2);
    await expect(page.getByTestId("campaign-counts")).toContainText("3 matched");
    expect(await page.evaluate(() => window.innerWidth <= screen.width)).toBe(true);

    // The list carries both, with the sent one's summary; the bell has the "sent" note.
    await page.goto("/campaigns");
    await expect(page.getByTestId("campaign-row").filter({ hasText: nowName })).toContainText(
      c.status.DONE,
    );
    await expect(page.getByTestId("campaign-row").filter({ hasText: name })).toContainText(
      c.status.CANCELLED,
    );
    await page.goto("/notifications");
    await expect(page.getByText(`Campaign "${nowName}" sent`)).toBeVisible();

    // R10 lists it.
    await page.goto("/reports/r10");
    await expect(page.getByTestId("table-campaigns")).toContainText(nowName);
  });

  test("a salesperson has no campaigns, no festival settings", async ({ page }) => {
    const seller = await makeStaff("SALESPERSON", "E2E Campaign Outsider");
    users.push(seller.id);
    await signIn(page, seller.mobile, "SALESPERSON");
    for (const path of ["/campaigns", "/campaigns/new", "/reports/r10"]) {
      expect((await page.request.get(path)).status()).toBe(404);
    }
    expect((await page.request.get("/settings/festivals")).status()).not.toBe(200);
  });
});
