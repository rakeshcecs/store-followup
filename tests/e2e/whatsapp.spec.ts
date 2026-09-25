import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M22 in the browser: the admin connects WhatsApp; a salesperson records consent, sends
// an approved message and replies inside the 24-hour window; Meta's webhook (signed here
// the way Meta signs it) brings ticks, a reply, a STOP and an unknown number. The worker
// is not running, so messages stay "Waiting to send" — sending is covered by
// tests/db/whatsapp.test.ts against a fake Meta.
//
// Desktop only: the store has one WhatsApp connection, and two projects saving it at
// once would sign the webhook with each other's secret.

const APP_SECRET = `e2e-secret-${randomUUID().slice(0, 8)}`;
const VERIFY = "e2e-verify";
const CONNECTION_KEY = "whatsapp:connection";
const tag = randomUUID().slice(0, 6);

async function webhook(request: APIRequestContext, value: Record<string, unknown>) {
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value }] }],
  });
  return request.post("/api/whatsapp/webhook", {
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`,
    },
    data: raw,
  });
}

test.describe("WhatsApp", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ isMobile }) => isMobile, "one store-wide connection: desktop only");

  const users: string[] = [];
  const customers: string[] = [];
  const templates: string[] = [];
  let before: unknown;

  test.beforeAll(async () => {
    before = (await db.setting.findUnique({ where: { key: CONNECTION_KEY } }))?.value ?? null;
  });

  test.afterAll(async () => {
    const where = { customerId: { in: customers } };
    await db.timelineEvent.deleteMany({ where });
    await db.whatsAppMessage.deleteMany({ where });
    await db.job.deleteMany({ where: { type: "whatsapp-send", status: "PENDING" } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.whatsAppTemplate.deleteMany({ where: { id: { in: templates } } });
    await db.whatsAppUnknownMessage.deleteMany({ where: { body: { contains: tag } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    // Whatever connection the database had before this spec.
    if (before === null) await db.setting.deleteMany({ where: { key: CONNECTION_KEY } });
    else
      await db.setting.update({ where: { key: CONNECTION_KEY }, data: { value: before as never } });
    await db.$disconnect();
  });

  test("the admin connects WhatsApp; secrets are never shown again; a manager cannot open it", async ({
    page,
    browser,
  }) => {
    const admin = await makeStaff("ADMIN", "E2E WA Admin");
    const manager = await makeStaff("MANAGER", "E2E WA Manager");
    users.push(admin.id, manager.id);

    await signIn(page, admin.mobile, "ADMIN");
    await page.goto("/settings");
    await page.getByRole("link", { name: new RegExp(en.settings.whatsapp) }).click();
    await expect(page).toHaveURL(/\/settings\/whatsapp$/);
    await expect(page.getByTestId("webhook-url")).toContainText("/api/whatsapp/webhook");

    const s = en.whatsapp.settings;
    await page.getByLabel(s.phoneNumberId).fill("12");
    await page.getByLabel(s.wabaId).fill("9876543210");
    await page.getByRole("button", { name: s.saveConnection }).click();
    await expect(page.getByText(en.whatsapp.errors.phoneNumberId)).toBeVisible();

    await page.getByLabel(s.phoneNumberId).fill("1234567890");
    await page.getByLabel(s.accessToken).fill("EAAG-e2e-token");
    await page.getByLabel(s.appSecret).fill(APP_SECRET);
    await page.getByLabel(s.verifyToken).fill(VERIFY);
    await page.getByRole("button", { name: s.saveConnection }).click();
    await expect(page.getByTestId("wa-connected")).toHaveText(s.connected);
    await page.reload();
    await expect(page.getByLabel(s.accessToken)).toHaveValue("");
    await expect(page.getByText(s.secretSaved).first()).toBeVisible();
    await expect(page.getByLabel(s.phoneNumberId)).toHaveValue("1234567890");
    const stored = JSON.stringify(
      (await db.setting.findUniqueOrThrow({ where: { key: CONNECTION_KEY } })).value,
    );
    expect(stored).not.toContain("EAAG-e2e-token");
    expect(stored).not.toContain(APP_SECRET);

    // Meta's handshake answers with the token just saved.
    const handshake = await page.request.get(
      `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=777`,
    );
    expect(await handshake.text()).toBe("777");

    const other = await browser.newContext();
    const managerPage = await other.newPage();
    await signIn(managerPage, manager.mobile, "MANAGER");
    expect((await managerPage.request.get("/settings/whatsapp")).status()).not.toBe(200);
    await other.close();
  });

  test("consent, an approved message with its preview, ticks, a reply, free text, then STOP", async ({
    page,
  }) => {
    const sales = await makeStaff("SALESPERSON", "E2E WA Seller");
    users.push(sales.id);
    const customer = await db.customer.create({
      data: {
        name: "Meena Shah",
        mobile: randomMobile(),
        assignedToId: sales.id,
        homeBranchId: sales.homeBranchId,
      },
    });
    customers.push(customer.id);
    const approved = await db.whatsAppTemplate.create({
      data: {
        name: `e2e_welcome_${tag}`,
        language: "en",
        metaLanguage: "en_US",
        category: "UTILITY",
        body: "Hello {{1}}, thank you for visiting us!",
        variables: ["1"],
        mapping: { "1": "customerFirstName" },
        metaStatus: "APPROVED",
      },
    });
    const needsBill = await db.whatsAppTemplate.create({
      data: {
        name: `e2e_bill_${tag}`,
        language: "en",
        metaLanguage: "en_US",
        category: "UTILITY",
        body: "Your bill {{1}}",
        variables: ["1"],
        mapping: { "1": "billNumber" },
        metaStatus: "APPROVED",
      },
    });
    templates.push(approved.id, needsBill.id);

    await signIn(page, sales.mobile, "SALESPERSON");
    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("link", { name: en.whatsapp.send }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}/whatsapp`));

    // BR-19: no consent, no sending.
    await expect(page.getByText(en.whatsapp.noConsent.title)).toBeVisible();
    await expect(page.getByRole("button", { name: en.whatsapp.sendTemplate })).toHaveCount(0);
    await page.getByRole("button", { name: en.whatsapp.recordConsent }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: en.whatsapp.consentConfirm })
      .click();
    await expect(page.getByText(en.whatsapp.consentSaved)).toBeVisible();

    // The preview is filled for this customer; the bill template cannot be used (no sale).
    const option = page.getByRole("radio", { name: new RegExp(`e2e_welcome_${tag}`) });
    await expect(option).toContainText("Hello Meena, thank you for visiting us!");
    await expect(page.getByTestId("template-unusable")).toContainText(`e2e_bill_${tag}`);
    await expect(page.getByTestId("window-closed")).toBeVisible();
    await option.click();
    await page.getByRole("button", { name: en.whatsapp.sendTemplate }).click();
    await expect(page.getByText(en.whatsapp.sent)).toBeVisible();
    const out = page.getByTestId("whatsapp-message").filter({ hasText: "Hello Meena" });
    await expect(out.getByTestId("whatsapp-status")).toHaveText(en.whatsapp.status.QUEUED);
    const message = await db.whatsAppMessage.findFirstOrThrow({
      where: { customerId: customer.id, direction: "OUT" },
    });
    expect(message).toMatchObject({
      status: "QUEUED",
      sentById: sales.id,
      templateId: approved.id,
    });

    // The worker sent it (not running here): Meta's ticks arrive by webhook.
    await db.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: "SENT", metaMessageId: `wamid.e2e.${tag}` },
    });
    expect(
      (
        await webhook(page.request, { statuses: [{ id: `wamid.e2e.${tag}`, status: "read" }] })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(out.getByTestId("whatsapp-status")).toHaveText(en.whatsapp.status.READ);

    // The customer replies: the window opens and free text is allowed.
    await webhook(page.request, {
      messages: [
        {
          from: `91${customer.mobile}`,
          id: `wamid.in.${tag}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "What time do you open?" },
        },
      ],
    });
    await page.reload();
    await expect(
      page.getByTestId("whatsapp-message").filter({ hasText: "What time do you open?" }),
    ).toHaveAttribute("data-direction", "IN");
    await page.getByLabel(en.whatsapp.reply).fill("We open at 10 AM.");
    await page.getByRole("button", { name: en.whatsapp.sendReply }).click();
    await expect(page.getByText(en.whatsapp.sent)).toBeVisible();
    await expect(
      page.getByTestId("whatsapp-message").filter({ hasText: "We open at 10 AM." }),
    ).toBeVisible();

    // The bell tells the salesperson about the reply.
    await page.goto("/notifications");
    await expect(page.getByText("WhatsApp from Meena Shah")).toBeVisible();

    // On the profile's history, with the ticks.
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByText(en.timeline.whatsappIn).first()).toBeVisible();
    await expect(page.getByText(en.timeline.byCustomer).first()).toBeVisible();

    // STOP: consent is off at once and the page asks for consent again.
    await webhook(page.request, {
      messages: [
        {
          from: `91${customer.mobile}`,
          id: `wamid.stop.${tag}`,
          type: "text",
          text: { body: "STOP" },
        },
      ],
    });
    await page.goto(`/customers/${customer.id}/whatsapp`);
    await expect(page.getByText(en.whatsapp.noConsent.title)).toBeVisible();
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).whatsappConsent,
    ).toBe(false);
  });

  test("an unknown number reaches managers, not salespeople", async ({ page, browser }) => {
    const manager = await makeStaff("MANAGER", "E2E WA Unknown Manager");
    const sales = await makeStaff("SALESPERSON", "E2E WA Unknown Seller");
    users.push(manager.id, sales.id);
    const mobile = randomMobile();
    await webhook(page.request, {
      messages: [
        {
          from: `91${mobile}`,
          id: `wamid.unknown.${tag}`,
          type: "text",
          text: { body: `Saree price? ${tag}` },
        },
      ],
    });

    await signIn(page, manager.mobile, "MANAGER");
    await page.goto("/reports");
    await page.getByRole("link", { name: new RegExp(en.whatsapp.unknown.title) }).click();
    const card = page.getByTestId("unknown-message").filter({ hasText: tag });
    await expect(card).toContainText(`Saree price? ${tag}`);
    await expect(card.getByRole("link", { name: en.whatsapp.unknown.addCustomer })).toHaveAttribute(
      "href",
      `/customers?mobile=${mobile}`,
    );
    await card.getByRole("button", { name: en.whatsapp.unknown.handled }).click();
    await expect(page.getByTestId("unknown-message").filter({ hasText: tag })).toHaveCount(0);

    const other = await browser.newContext();
    const salesPage = await other.newPage();
    await signIn(salesPage, sales.mobile, "SALESPERSON");
    expect((await salesPage.request.get("/whatsapp/unknown")).status()).toBe(404);
    await other.close();
  });
});
