import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/lib/actions/whatsapp");
const { GET, POST } = await import("@/app/api/whatsapp/webhook/route");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { customerTimeline } = await import("@/lib/customers");
const { deliverWhatsApp } = await import("@/lib/whatsapp/send");
const { queueAutomaticWhatsApp } = await import("@/lib/whatsapp/automatic");
const { saveAutomatic, saveConnection, WHATSAPP_SETTING } = await import("@/lib/whatsapp/settings");
const { renderNotifications } = await import("@/lib/notification-text");
const { ALL_BRANCHES } = await import("@/lib/permissions");
const { isoDate } = await import("@/lib/format");
const { addDays } = await import("@/lib/follow-up-dates");
const { makeCustomer, makeEnquiry } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs, viewingBranch } = await import("../helpers/session");
type TestStore = Awaited<ReturnType<typeof makeStore>>;

// M22 against a fake Meta: consent and the 24-hour window (BR-19, BR-20), the worker's
// send and its retries, the signed webhook (ticks, replies, STOP, unknown numbers),
// automatic messages and the template sync. Two branches, two managers, two
// salespeople and an admin.

const APP_SECRET = "test-app-secret";
const VERIFY = "test-verify-token";
let store: TestStore;
let tag: string;

type Call = { url: string; body: Record<string, unknown> | null };
let calls: Call[];
let reply: (call: Call) => { status: number; body: unknown };

beforeEach(async () => {
  store = await makeStore();
  tag = randomUUID().slice(0, 8);
  calls = [];
  reply = () => ({ status: 200, body: { messages: [{ id: `wamid.${randomUUID()}` }] } });
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    const call = { url: String(url), body: init?.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const answer = reply(call);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  await db.$transaction((tx) =>
    saveConnection(
      tx,
      {
        phoneNumberId: "1234567890",
        wabaId: "9876543210",
        accessToken: "EAAG-test-token",
        appSecret: APP_SECRET,
        verifyToken: VERIFY,
      },
      store.admin.id,
    ),
  );
  await signInAs(store.salesA.mobile);
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => db.$disconnect());

async function template(
  name: string,
  body: string,
  mapping: Record<string, string> | null,
  status: "APPROVED" | "PENDING" | "REJECTED" = "APPROVED",
) {
  const variables = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]!))];
  return db.whatsAppTemplate.create({
    data: {
      name: `${name}_${tag}_${randomUUID().slice(0, 4)}`,
      language: "en",
      metaLanguage: "en_US",
      category: "UTILITY",
      body,
      variables,
      mapping: mapping ?? undefined,
      metaStatus: status,
    },
  });
}

async function consenting(branchId = store.branchA.id, assignedToId = store.salesA.id) {
  const customer = await makeCustomer(branchId, assignedToId);
  return db.customer.update({
    where: { id: customer.id },
    data: { name: "Asha Patel", whatsappConsent: true, whatsappConsentAt: new Date() },
  });
}

function signed(payload: unknown, secret = APP_SECRET) {
  const raw = JSON.stringify(payload);
  return new Request("http://localhost/api/whatsapp/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
    },
    body: raw,
  });
}

const webhook = (value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "messages", value }] }],
});

describe("sending from the profile", () => {
  it("BR-19: no consent, no message — nothing written, nothing queued", async () => {
    const customer = await makeCustomer(store.branchA.id, store.salesA.id);
    const hello = await template("hello", "Hello {{1}}", { "1": "customerFirstName" });
    const result = await actions.sendWhatsAppTemplate({
      customerId: customer.id,
      templateId: hello.id,
    });
    expect(result).toMatchObject({ ok: false, message: "whatsapp.errors.noConsent" });
    expect(await db.whatsAppMessage.count({ where: { customerId: customer.id } })).toBe(0);
  });

  it("recording consent is audited and on the timeline; then a template is queued, filled", async () => {
    const customer = await makeCustomer(store.branchA.id, store.salesA.id);
    await db.customer.update({ where: { id: customer.id }, data: { name: "Asha Patel" } });
    expect(
      (await actions.recordWhatsAppConsent({ customerId: customer.id, confirmed: false as never }))
        .ok,
    ).toBe(false);
    expect(
      await actions.recordWhatsAppConsent({ customerId: customer.id, confirmed: true }),
    ).toMatchObject({ ok: true });
    const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.whatsappConsent).toBe(true);
    expect(after.whatsappConsentAt).not.toBeNull();
    expect(
      await db.auditLog.count({
        where: { entityId: customer.id, action: AUDIT.whatsappConsent, userId: store.salesA.id },
      }),
    ).toBe(1);

    const hello = await template("hello", "Hello {{1}}, welcome to {{2}} ({{3}}).", {
      "1": "customerFirstName",
      "2": "storeName",
      "3": "branchName",
    });
    const result = await actions.sendWhatsAppTemplate({
      customerId: customer.id,
      templateId: hello.id,
    });
    expect(result.ok).toBe(true);
    const message = await db.whatsAppMessage.findFirstOrThrow({
      where: { customerId: customer.id },
    });
    expect(message).toMatchObject({
      status: "QUEUED",
      direction: "OUT",
      kind: "TEMPLATE",
      branchId: store.branchA.id,
      sentById: store.salesA.id,
      templateId: hello.id,
    });
    expect(message.variables).toEqual(["Asha", expect.any(String), store.branchA.name]);
    expect(message.body).toBe(
      `Hello Asha, welcome to ${(message.variables as string[])[1]} (${store.branchA.name}).`,
    );
    expect(
      await db.job.count({
        where: { type: "whatsapp-send", singletonKey: `whatsapp-send:${message.id}` },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: message.id, action: AUDIT.whatsappSend } }),
    ).toBe(1);
    const { events } = await customerTimeline(customer.id, 20);
    expect(events.find((event) => event.entityId === message.id)).toMatchObject({
      type: "wa.sent",
      whatsappStatus: "QUEUED",
      staffName: expect.any(String),
    });
    // Queuing never calls Meta: the worker does.
    expect(calls).toEqual([]);
  });

  it("only approved, mapped templates the customer has every field for", async () => {
    const customer = await consenting();
    const pending = await template("pending", "Hi {{1}}", { "1": "customerFirstName" }, "PENDING");
    const unmapped = await template("unmapped", "Hi {{1}}", null);
    const bill = await template("bill", "Bill {{1}}", { "1": "billNumber" });
    for (const [id, message] of [
      [pending.id, "whatsapp.errors.templateNotApproved"],
      [unmapped.id, "whatsapp.errors.templateNotMapped"],
      [bill.id, "whatsapp.errors.missingField"],
    ] as const) {
      expect(
        await actions.sendWhatsAppTemplate({ customerId: customer.id, templateId: id }),
      ).toMatchObject({ ok: false, message });
    }
    // With a sale, the bill number is there.
    const enquiry = await makeEnquiry(customer.id, store.salesA.id);
    await db.sale.create({
      data: {
        branchId: store.branchA.id,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        billNumber: `B-${tag}`,
        billDate: new Date(),
        salespersonId: store.salesA.id,
      },
    });
    expect(
      await actions.sendWhatsAppTemplate({ customerId: customer.id, templateId: bill.id }),
    ).toMatchObject({ ok: true });
    expect(
      (await db.whatsAppMessage.findFirstOrThrow({ where: { customerId: customer.id } })).body,
    ).toBe(`Bill B-${tag}`);
  });

  it("an admin on All branches picks one first; another branch's salesperson may send to a shared customer", async () => {
    const customer = await consenting();
    const hello = await template("hello", "Hello {{1}}", { "1": "customerFirstName" });
    await signInAs(store.admin.mobile);
    viewingBranch(ALL_BRANCHES);
    expect(
      await actions.sendWhatsAppTemplate({ customerId: customer.id, templateId: hello.id }),
    ).toMatchObject({ ok: false, message: "branch.errors.pickOne" });

    await signInAs(store.salesB.mobile);
    expect(
      await actions.sendWhatsAppTemplate({ customerId: customer.id, templateId: hello.id }),
    ).toMatchObject({ ok: true });
    expect(
      (await db.whatsAppMessage.findFirstOrThrow({ where: { customerId: customer.id } })).branchId,
    ).toBe(store.branchB.id);
  });

  it("BR-20: free text only within 24 hours of the customer's last message", async () => {
    const customer = await consenting();
    const closed = await actions.sendWhatsAppText({ customerId: customer.id, text: "Hi!" });
    expect(closed).toMatchObject({ ok: false, message: "whatsapp.errors.windowClosed" });

    await db.customer.update({
      where: { id: customer.id },
      data: { whatsappLastInAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    expect((await actions.sendWhatsAppText({ customerId: customer.id, text: "Hi!" })).ok).toBe(
      false,
    );

    await db.customer.update({
      where: { id: customer.id },
      data: { whatsappLastInAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });
    expect(await actions.sendWhatsAppText({ customerId: customer.id, text: "  " })).toMatchObject({
      ok: false,
      code: "VALIDATION",
      field: "text",
    });
    expect(
      await actions.sendWhatsAppText({ customerId: customer.id, text: "Your suit is ready." }),
    ).toMatchObject({ ok: true });
    expect(
      await db.whatsAppMessage.findFirstOrThrow({ where: { customerId: customer.id } }),
    ).toMatchObject({ kind: "TEXT", body: "Your suit is ready.", templateId: null });
  });
});

describe("the worker's send", () => {
  async function queued(kind: "TEMPLATE" | "TEXT" = "TEMPLATE") {
    const customer = await consenting();
    const hello = await template("hello", "Hello {{1}}", { "1": "customerFirstName" });
    if (kind === "TEXT") {
      await db.customer.update({
        where: { id: customer.id },
        data: { whatsappLastInAt: new Date() },
      });
      await actions.sendWhatsAppText({ customerId: customer.id, text: "Ready" });
    } else {
      await actions.sendWhatsAppTemplate({ customerId: customer.id, templateId: hello.id });
    }
    const message = await db.whatsAppMessage.findFirstOrThrow({
      where: { customerId: customer.id },
    });
    return { customer, hello, message };
  }

  it("sends the template to Meta with the filled values and keeps Meta's id", async () => {
    const { customer, hello, message } = await queued();
    await deliverWhatsApp(message.id, false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/v\d+\.\d+\/1234567890\/messages$/);
    expect(calls[0]!.body).toMatchObject({
      messaging_product: "whatsapp",
      to: `91${customer.mobile}`,
      type: "template",
      template: {
        name: hello.name,
        language: { code: "en_US" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Asha" }] }],
      },
    });
    const sent = await db.whatsAppMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.metaMessageId).toMatch(/^wamid\./);
    expect(sent.sentAt).not.toBeNull();

    // Sent twice by a retried job: Meta is not called again.
    await deliverWhatsApp(message.id, false);
    expect(calls).toHaveLength(1);
  });

  it("free text goes as text", async () => {
    const { message } = await queued("TEXT");
    await deliverWhatsApp(message.id, false);
    expect(calls[0]!.body).toMatchObject({ type: "text", text: { body: "Ready" } });
  });

  it("BR-19 again at send time: a STOP after queuing means it is not sent", async () => {
    const { customer, message } = await queued();
    await db.customer.update({ where: { id: customer.id }, data: { whatsappConsent: false } });
    await deliverWhatsApp(message.id, false);
    expect(calls).toEqual([]);
    expect(await db.whatsAppMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject(
      { status: "FAILED", errorCode: "no-consent" },
    );
  });

  it("a rate limit is retried; on the last try, and for a bad number at once, it fails with Meta's reason", async () => {
    const { message } = await queued();
    reply = () => ({
      status: 400,
      body: { error: { code: 130429, message: "Rate limit hit" } },
    });
    await expect(deliverWhatsApp(message.id, false)).rejects.toThrow("Rate limit hit");
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      "QUEUED",
    );
    await deliverWhatsApp(message.id, true);
    expect(await db.whatsAppMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject(
      { status: "FAILED", errorCode: "130429", error: "Rate limit hit" },
    );

    const second = await queued();
    reply = () => ({
      status: 400,
      body: { error: { code: 131026, message: "Message undeliverable" } },
    });
    await deliverWhatsApp(second.message.id, false);
    expect(
      await db.whatsAppMessage.findUniqueOrThrow({ where: { id: second.message.id } }),
    ).toMatchObject({ status: "FAILED", errorCode: "131026" });
  });

  it("not connected yet: waits for another try instead of failing", async () => {
    const { message } = await queued();
    await db.setting.delete({ where: { key: WHATSAPP_SETTING.connection } });
    await expect(deliverWhatsApp(message.id, false)).rejects.toThrow("not connected");
    expect(calls).toEqual([]);
  });
});

describe("the webhook", () => {
  it("verifies Meta's handshake with the verify token", async () => {
    const url = (token: string) =>
      new Request(
        `http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`,
      );
    const ok = await GET(url(VERIFY) as never);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    expect((await GET(url("wrong") as never)).status).toBe(403);
  });

  it("refuses an unsigned or wrongly signed event", async () => {
    const payload = webhook({ statuses: [] });
    expect((await POST(signed(payload, "not-the-secret") as never)).status).toBe(403);
    const unsigned = new Request("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect((await POST(unsigned as never)).status).toBe(403);
  });

  it("ticks move forward only: sent → delivered → read, and a late 'delivered' changes nothing", async () => {
    const customer = await consenting();
    const message = await db.whatsAppMessage.create({
      data: {
        customerId: customer.id,
        branchId: store.branchA.id,
        direction: "OUT",
        body: "Hello",
        status: "SENT",
        metaMessageId: `wamid.${tag}`,
      },
    });
    const status = (value: string, extra: Record<string, unknown> = {}) =>
      POST(
        signed(
          webhook({
            statuses: [{ id: `wamid.${tag}`, status: value, timestamp: "1790000000", ...extra }],
          }),
        ) as never,
      );
    expect((await status("delivered")).status).toBe(200);
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      "DELIVERED",
    );
    await status("read");
    await status("delivered");
    await status("failed", { errors: [{ code: 131047, title: "Re-engagement message" }] });
    const final = await db.whatsAppMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(final.status).toBe("READ");
    expect(final.readAt?.getTime()).toBe(1790000000 * 1000);
  });

  it("a failure before delivery is kept with Meta's reason", async () => {
    const customer = await consenting();
    const message = await db.whatsAppMessage.create({
      data: {
        customerId: customer.id,
        branchId: store.branchA.id,
        direction: "OUT",
        body: "Hello",
        status: "SENT",
        metaMessageId: `wamid.f${tag}`,
      },
    });
    await POST(
      signed(
        webhook({
          statuses: [
            {
              id: `wamid.f${tag}`,
              status: "failed",
              errors: [
                {
                  code: 131026,
                  title: "Undeliverable",
                  error_data: { details: "Not on WhatsApp" },
                },
              ],
            },
          ],
        }),
      ) as never,
    );
    expect(await db.whatsAppMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject(
      { status: "FAILED", errorCode: "131026", error: "Not on WhatsApp" },
    );
  });

  it("a reply: on the customer, on the timeline, window open, the salesperson told — once", async () => {
    const customer = await consenting();
    const event = webhook({
      contacts: [{ wa_id: `91${customer.mobile}`, profile: { name: "Asha" } }],
      messages: [
        {
          from: `91${customer.mobile}`,
          id: `wamid.in${tag}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "Is the sherwani ready?" },
        },
      ],
    });
    expect((await POST(signed(event) as never)).status).toBe(200);
    expect((await POST(signed(event) as never)).status).toBe(200); // Meta sends it again

    const incoming = await db.whatsAppMessage.findMany({ where: { customerId: customer.id } });
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({
      direction: "IN",
      kind: "INCOMING",
      body: "Is the sherwani ready?",
      branchId: store.branchA.id,
    });
    const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.whatsappLastInAt).not.toBeNull();
    expect(after.whatsappConsent).toBe(true);
    const notes = await db.notification.findMany({ where: { userId: store.salesA.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: "whatsapp-in",
      link: `/customers/${customer.id}/whatsapp`,
    });
    const rendered = await renderNotifications(notes, "en");
    expect(rendered.get(notes[0]!.id)?.title).toBe("WhatsApp from Asha Patel");
    const { events } = await customerTimeline(customer.id, 20);
    expect(events[0]).toMatchObject({
      type: "wa.received",
      detail: "Is the sherwani ready?",
      staffName: null,
    });

    // …and now free text is allowed.
    expect(
      (await actions.sendWhatsAppText({ customerId: customer.id, text: "Yes, come today." })).ok,
    ).toBe(true);
    // Manager B was not told (their branch does not look after this customer).
    expect(await db.notification.count({ where: { userId: store.managerB.id } })).toBe(0);
  });

  it("STOP in Gujarati switches consent off at once; nothing more can be sent (BR-19)", async () => {
    const customer = await consenting();
    const hello = await template("hello", "Hello {{1}}", { "1": "customerFirstName" });
    await actions.sendWhatsAppTemplate({ customerId: customer.id, templateId: hello.id });
    const waiting = await db.whatsAppMessage.findFirstOrThrow({
      where: { customerId: customer.id, direction: "OUT" },
    });

    await POST(
      signed(
        webhook({
          messages: [
            {
              from: `91${customer.mobile}`,
              id: `wamid.stop${tag}`,
              type: "text",
              text: { body: "બંધ" },
            },
          ],
        }),
      ) as never,
    );
    const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.whatsappConsent).toBe(false);
    expect(
      await db.auditLog.count({ where: { entityId: customer.id, action: AUDIT.whatsappStop } }),
    ).toBe(1);
    expect(
      await db.timelineEvent.count({
        where: { customerId: customer.id, type: "customer.whatsappStop" },
      }),
    ).toBe(1);
    expect(
      (await db.notification.findFirstOrThrow({ where: { userId: store.salesA.id } })).type,
    ).toBe("whatsapp-stop");

    // New sends are refused, and the one already queued is not sent.
    expect(
      await actions.sendWhatsAppTemplate({ customerId: customer.id, templateId: hello.id }),
    ).toMatchObject({ ok: false, message: "whatsapp.errors.noConsent" });
    await deliverWhatsApp(waiting.id, false);
    expect(calls).toEqual([]);
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe(
      "FAILED",
    );
  });

  it("Meta's 'Stop promotions' button, and a message to the alternate number", async () => {
    const customer = await consenting();
    const alt = `7${customer.mobile!.slice(1)}`;
    await db.customer.update({ where: { id: customer.id }, data: { altMobile: alt } });
    await POST(
      signed(
        webhook({
          messages: [
            {
              from: `91${alt}`,
              id: `wamid.btn${tag}`,
              type: "button",
              button: { text: "Stop promotions", payload: "STOP" },
            },
          ],
        }),
      ) as never,
    );
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).whatsappConsent,
    ).toBe(false);
  });

  it("an unknown number goes to Unknown contacts, for managers only to clear", async () => {
    const mobile = `6${String(Date.now()).slice(-9)}`;
    await POST(
      signed(
        webhook({
          contacts: [{ wa_id: `91${mobile}`, profile: { name: "Ravi" } }],
          messages: [
            {
              from: `91${mobile}`,
              id: `wamid.u${tag}`,
              type: "text",
              text: { body: "Price of saree?" },
            },
          ],
        }),
      ) as never,
    );
    const row = await db.whatsAppUnknownMessage.findUniqueOrThrow({
      where: { metaMessageId: `wamid.u${tag}` },
    });
    expect(row).toMatchObject({ fromMobile: mobile, profileName: "Ravi", body: "Price of saree?" });

    expect(await actions.markUnknownHandled({ id: row.id })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    await signInAs(store.managerB.mobile);
    expect(await actions.markUnknownHandled({ id: row.id })).toMatchObject({ ok: true });
    expect(
      (await db.whatsAppUnknownMessage.findUniqueOrThrow({ where: { id: row.id } })).handledById,
    ).toBe(store.managerB.id);
  });
});

describe("automatic messages", () => {
  // 12:00 IST today; the tick is given its "now" so the tests do not depend on the clock.
  const noon = () => new Date(`${isoDate(new Date())}T06:30:00.000Z`);

  it("thank you, 1 hour after a sale, once — only with consent, and only when switched on", async () => {
    const thanks = await template("thanks", "Thank you {{1}} for bill {{2}}", {
      "1": "customerFirstName",
      "2": "billNumber",
    });
    const now = noon();
    const withConsent = await consenting();
    const without = await makeCustomer(store.branchA.id, store.salesA.id);
    const sales = [];
    for (const customer of [withConsent, without]) {
      const enquiry = await makeEnquiry(customer.id, store.salesA.id);
      sales.push(
        await db.sale.create({
          data: {
            branchId: store.branchA.id,
            customerId: customer.id,
            enquiryId: enquiry.id,
            clientId: randomUUID(),
            billNumber: `T-${randomUUID().slice(0, 6)}`,
            billDate: now,
            salespersonId: store.salesA.id,
            createdAt: new Date(now.getTime() - 70 * 60 * 1000),
          },
        }),
      );
    }

    await queueAutomaticWhatsApp(now);
    expect(await db.whatsAppMessage.count({ where: { customerId: withConsent.id } })).toBe(0);

    const off = { enabled: false, templateId: null };
    await db.$transaction((tx) =>
      saveAutomatic(
        tx,
        { thankYou: { enabled: true, templateId: thanks.id }, visitReminder: off, occasion: off },
        store.admin.id,
      ),
    );
    await queueAutomaticWhatsApp(now);
    await queueAutomaticWhatsApp(now); // the next minute
    const messages = await db.whatsAppMessage.findMany({
      where: { customerId: { in: [withConsent.id, without.id] } },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      customerId: withConsent.id,
      kind: "THANK_YOU",
      sentById: null,
      dedupeKey: `thanks:${sales[0]!.id}`,
      body: `Thank you Asha for bill ${sales[0]!.billNumber}`,
    });
    const { events } = await customerTimeline(withConsent.id, 20);
    expect(events.find((event) => event.type === "wa.sent")?.staffName).toBeNull();

    // A sale 30 minutes old waits; nothing goes out after 9 PM.
    const late = new Date(`${isoDate(new Date())}T15:45:00.000Z`); // 21:15 IST
    expect(await queueAutomaticWhatsApp(late)).toBe(0);
  });

  it("visit reminder from 6 PM for tomorrow's 'customer will visit'; occasion greeting on the day", async () => {
    const reminder = await template("visit", "See you tomorrow {{1}}", {
      "1": "customerFirstName",
    });
    const greeting = await template("occasion", "Happy {{1}}!", { "1": "occasion" });
    const today = isoDate(new Date());
    const evening = new Date(`${today}T13:00:00.000Z`); // 18:30 IST
    const visitor = await consenting();
    const enquiry = await makeEnquiry(visitor.id, store.salesA.id);
    const followUp = await db.followUp.create({
      data: {
        branchId: store.branchB.id,
        customerId: visitor.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${addDays(today, 1)}T00:00:00.000Z`),
        timeSlot: "EVENING",
        method: "VISIT",
        assignedToId: store.salesA.id,
        createdFrom: "PROFILE",
      },
    });
    const celebrating = await consenting();
    await db.customer.update({
      where: { id: celebrating.id },
      data: { occasion: "Wedding anniversary", occasionDate: new Date(`${today}T00:00:00.000Z`) },
    });
    await db.$transaction((tx) =>
      saveAutomatic(
        tx,
        {
          thankYou: { enabled: false, templateId: null },
          visitReminder: { enabled: true, templateId: reminder.id },
          occasion: { enabled: true, templateId: greeting.id },
        },
        store.admin.id,
      ),
    );

    // At noon: the occasion yes, the visit reminder not yet.
    await queueAutomaticWhatsApp(noon());
    expect(await db.whatsAppMessage.count({ where: { customerId: visitor.id } })).toBe(0);
    expect(
      await db.whatsAppMessage.findFirstOrThrow({ where: { customerId: celebrating.id } }),
    ).toMatchObject({ kind: "OCCASION", body: "Happy Wedding anniversary!" });

    await queueAutomaticWhatsApp(evening);
    await queueAutomaticWhatsApp(evening);
    const reminders = await db.whatsAppMessage.findMany({ where: { customerId: visitor.id } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      kind: "VISIT_REMINDER",
      branchId: store.branchB.id,
      dedupeKey: `visit-reminder:${followUp.id}`,
    });
    expect(await db.whatsAppMessage.count({ where: { customerId: celebrating.id } })).toBe(1);
  });

  it("more than one batch due: the next minute sends the rest, not the first 100 again", async () => {
    const greeting = await template("occasion_many", "Happy {{1}}!", { "1": "occasion" });
    const today = isoDate(noon());
    const ids = Array.from({ length: 105 }, () => randomUUID());
    await db.customer.createMany({
      data: ids.map((id, i) => ({
        id,
        name: `Batch ${i}`,
        mobile: `7${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
        assignedToId: store.salesA.id,
        homeBranchId: store.branchA.id,
        whatsappConsent: true,
        occasion: "Birthday",
        occasionDate: new Date(`${today}T00:00:00.000Z`),
      })),
    });
    const off = { enabled: false, templateId: null };
    await db.$transaction((tx) =>
      saveAutomatic(
        tx,
        { thankYou: off, visitReminder: off, occasion: { enabled: true, templateId: greeting.id } },
        store.admin.id,
      ),
    );
    const sent = () => db.whatsAppMessage.count({ where: { customerId: { in: ids } } });

    await queueAutomaticWhatsApp(noon());
    await queueAutomaticWhatsApp(noon());
    await queueAutomaticWhatsApp(noon());
    expect(await sent()).toBe(105);
  });
});

describe("settings (admin)", () => {
  it("only the admin; secrets are sealed in the database and never in the audit log", async () => {
    const input = {
      phoneNumberId: "1112223334",
      wabaId: "5556667778",
      accessToken: "EAAG-new-token-xyz",
      appSecret: "",
      verifyToken: "",
    };
    await signInAs(store.managerA.mobile);
    expect(await actions.saveWhatsAppConnection(input)).toMatchObject({ code: "FORBIDDEN" });

    await signInAs(store.admin.mobile);
    expect(await actions.saveWhatsAppConnection(input)).toMatchObject({ ok: true });
    const row = await db.setting.findUniqueOrThrow({ where: { key: WHATSAPP_SETTING.connection } });
    const stored = JSON.stringify(row.value);
    expect(stored).toContain("1112223334");
    expect(stored).not.toContain("EAAG-new-token-xyz");
    expect(stored).not.toContain(APP_SECRET); // kept from before, still sealed
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: WHATSAPP_SETTING.connection, userId: store.admin.id },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit.newValue)).not.toContain("EAAG");
    expect(audit.newValue).toMatchObject({ changed: ["accessToken"] });

    // The blank app secret kept the old one: the webhook still checks it.
    const payload = webhook({ statuses: [] });
    expect((await POST(signed(payload) as never)).status).toBe(200);
    expect(await actions.saveWhatsAppConnection({ ...input, phoneNumberId: "12" })).toMatchObject({
      ok: false,
      field: "phoneNumberId",
    });
  });

  it("the test message goes to Meta as hello_world; Meta's refusal is shown", async () => {
    await signInAs(store.admin.mobile);
    expect(await actions.sendWhatsAppTest({ mobile: "9825012345" })).toMatchObject({ ok: true });
    expect(calls[0]!.body).toMatchObject({
      to: "919825012345",
      template: { name: "hello_world", language: { code: "en_US" } },
    });
    reply = () => ({ status: 401, body: { error: { code: 190, message: "Invalid token" } } });
    expect(await actions.sendWhatsAppTest({ mobile: "9825012345" })).toMatchObject({
      ok: false,
      message: "whatsapp.errors.meta",
      values: { reason: "Invalid token", code: "190" },
    });
    await signInAs(store.salesA.mobile);
    expect(await actions.sendWhatsAppTest({ mobile: "9825012345" })).toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("templates sync from Meta: languages mapped, status kept, mapping kept, removed ones switched off", async () => {
    await signInAs(store.admin.mobile);
    const old = await template("gone", "Old one", null);
    const kept = await db.whatsAppTemplate.create({
      data: {
        name: `offer_${tag}`,
        language: "hi",
        metaLanguage: "hi",
        category: "MARKETING",
        body: "Namaste {{1}}",
        variables: ["1"],
        mapping: { "1": "customerFirstName" },
      },
    });
    reply = (call) =>
      call.url.includes("message_templates")
        ? {
            status: 200,
            body: {
              data: [
                {
                  id: "111",
                  name: `offer_${tag}`,
                  language: "hi",
                  status: "APPROVED",
                  category: "MARKETING",
                  components: [{ type: "BODY", text: "Namaste {{1}}, offer at {{2}}" }],
                },
                {
                  id: "222",
                  name: `welcome_${tag}`,
                  language: "en_US",
                  status: "PAUSED",
                  category: "UTILITY",
                  components: [
                    { type: "HEADER", format: "TEXT", text: "Hi" },
                    { type: "BODY", text: "Welcome!" },
                  ],
                },
                {
                  id: "333",
                  name: `marathi_${tag}`,
                  language: "mr",
                  status: "APPROVED",
                  category: "UTILITY",
                  components: [{ type: "BODY", text: "x" }],
                },
              ],
            },
          }
        : { status: 500, body: {} };
    expect(await actions.syncWhatsAppTemplates({})).toMatchObject({
      ok: true,
      data: { synced: 2, skipped: 1 },
    });
    expect(await db.whatsAppTemplate.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({
      metaStatus: "APPROVED",
      metaId: "111",
      variables: ["1", "2"],
      mapping: { "1": "customerFirstName" },
      active: true,
    });
    expect(
      await db.whatsAppTemplate.findFirstOrThrow({ where: { name: `welcome_${tag}` } }),
    ).toMatchObject({
      language: "en",
      metaLanguage: "en_US",
      metaStatus: "REJECTED",
      metaStatusText: "PAUSED",
    });
    expect((await db.whatsAppTemplate.findUniqueOrThrow({ where: { id: old.id } })).active).toBe(
      false,
    );

    // Mapping: every placeholder, only its own.
    expect(
      await actions.saveWhatsAppTemplateMapping({
        templateId: kept.id,
        mapping: { "1": "customerFirstName" },
      }),
    ).toMatchObject({ ok: false, message: "whatsapp.errors.mapEvery" });
    expect(
      await actions.saveWhatsAppTemplateMapping({
        templateId: kept.id,
        mapping: { "1": "customerFirstName", "2": "branchName" },
      }),
    ).toMatchObject({ ok: true });
  });

  it("an automatic message can be switched on only with an approved template", async () => {
    await signInAs(store.admin.mobile);
    const pending = await template("pending", "Hi", null, "PENDING");
    const approved = await template("ok", "Hi", null);
    const off = { enabled: false, templateId: "" };
    expect(
      await actions.saveAutomaticWhatsApp({
        thankYou: { enabled: true, templateId: pending.id },
        visitReminder: off,
        occasion: off,
      }),
    ).toMatchObject({ ok: false, field: "thankYou.templateId" });
    expect(
      await actions.saveAutomaticWhatsApp({
        thankYou: { enabled: true, templateId: approved.id },
        visitReminder: off,
        occasion: off,
      }),
    ).toMatchObject({ ok: true });
  });
});
