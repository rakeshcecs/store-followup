import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const campaigns = await import("@/lib/actions/campaign");
const festivals = await import("@/lib/actions/festival");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { requireUser } = await import("@/lib/auth");
const { previewAudience } = await import("@/lib/campaigns/audience");
const { listCampaigns, loadCampaign } = await import("@/lib/campaigns/list");
const { campaignResults } = await import("@/lib/campaigns/results");
const { runCampaign } = await import("@/lib/campaigns/send");
const { createOccasionFollowUps } = await import("@/lib/occasions");
const { renderNotifications } = await import("@/lib/notification-text");
const { ALL_BRANCHES } = await import("@/lib/permissions");
const { runReport } = await import("@/lib/reports/run");
const { campaignWeeklyLimit, occasionLeadDays, SETTING } = await import("@/lib/settings");
const { calendarDay } = await import("@/lib/follow-ups");
const { addDays } = await import("@/lib/follow-up-dates");
const { isoDate } = await import("@/lib/format");
const { deliverWhatsApp } = await import("@/lib/whatsapp/send");
const { saveConnection } = await import("@/lib/whatsapp/settings");
const { tick } = await import("../../worker/schedules");
const { makeCustomer, makeEnquiry } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs, viewingBranch } = await import("../helpers/session");
type TestStore = Awaited<ReturnType<typeof makeStore>>;

// M23 on the two-branch store: the 6 AM occasion follow-ups, who a campaign reaches and
// who it skips (BR-19, BR-21, missing details), the worker's run against a fake Meta,
// results that match the records, cancelling, R10, the festival calendar and its settings.

let store: TestStore;
let tag: string;
const TODAY = isoDate(new Date());

beforeEach(async () => {
  store = await makeStore();
  tag = randomUUID().slice(0, 8);
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${randomUUID()}` }] }), {
      status: 200,
    });
  });
  await db.$transaction((tx) =>
    saveConnection(
      tx,
      {
        phoneNumberId: "1234567890",
        wabaId: "9876543210",
        accessToken: "EAAG-test-token",
        appSecret: "test-secret",
        verifyToken: "test-verify",
      },
      store.admin.id,
    ),
  );
  // The defaults, whatever an earlier test set.
  await db.setting.deleteMany({
    where: { key: { in: [SETTING.occasionLeadDays, SETTING.campaignWeeklyLimit] } },
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => db.$disconnect());

async function template(body: string, mapping: Record<string, string> | null = null) {
  const variables = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]!))];
  return db.whatsAppTemplate.create({
    data: {
      name: `camp_${tag}_${randomUUID().slice(0, 4)}`,
      language: "en",
      metaLanguage: "en_US",
      category: "MARKETING",
      body,
      variables,
      mapping: mapping ?? undefined,
      metaStatus: "APPROVED",
    },
  });
}

async function customer(
  branchId: string,
  assignedToId: string,
  data: { consent?: boolean; name?: string; occasion?: string | null } = {},
) {
  const row = await makeCustomer(branchId, assignedToId);
  return db.customer.update({
    where: { id: row.id },
    data: {
      name: data.name ?? `Asha ${tag}`,
      whatsappConsent: data.consent ?? true,
      whatsappConsentAt: data.consent === false ? null : new Date(),
      occasion: data.occasion ?? null,
    },
  });
}

const as = async (mobile: string, branch?: string) => {
  await signInAs(mobile);
  if (branch) viewingBranch(branch);
  return requireUser();
};

const base = (templateId: string, branch: string) => ({
  branch,
  templateId,
  variables: { "1": { kind: "field" as const, field: "customerFirstName" as const } },
  filters: {},
});

describe("occasion follow-ups (6 AM job)", () => {
  const occasionDay = (leadDays: number) => calendarDay(addDays(TODAY, leadDays));

  it("a customer with an open enquiry N days before their occasion gets a call follow-up, in their salesperson's language", async () => {
    await db.user.update({ where: { id: store.salesA.id }, data: { language: "hi" } });
    const c = await customer(store.branchA.id, store.salesA.id, { occasion: "Wedding" });
    await db.customer.update({ where: { id: c.id }, data: { occasionDate: occasionDay(30) } });
    await makeEnquiry(c.id, store.salesA.id);

    expect(await createOccasionFollowUps(TODAY)).toBe(1);
    const followUp = await db.followUp.findFirstOrThrow({ where: { customerId: c.id } });
    expect(followUp).toMatchObject({
      status: "PENDING",
      createdFrom: "OCCASION",
      method: "CALL",
      timeSlot: "MORNING",
      assignedToId: store.salesA.id,
      branchId: store.branchA.id,
    });
    expect(isoDate(followUp.dueDate)).toBe(TODAY);
    expect(followUp.reason).toContain("अवसर");
    const timeline = await db.timelineEvent.findFirstOrThrow({
      where: { customerId: c.id, type: "followup.set" },
    });
    expect(timeline.staffId).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: followUp.id, action: AUDIT.followUpCreate },
    });
    expect(audit.userId).toBeNull();

    // The next morning's run finds them covered already.
    expect(await createOccasionFollowUps(TODAY)).toBe(0);
    expect(await db.followUp.count({ where: { customerId: c.id } })).toBe(1);
  });

  it("no enquiry at all: one is opened for the occasion (audited); a closed enquiry or a pending follow-up: skipped", async () => {
    const fresh = await customer(store.branchB.id, store.salesB.id, { occasion: "Anniversary" });
    const closed = await customer(store.branchB.id, store.salesB.id);
    const busy = await customer(store.branchB.id, store.salesB.id);
    const wrongDay = await customer(store.branchB.id, store.salesB.id);
    await db.customer.updateMany({
      where: { id: { in: [fresh.id, closed.id, busy.id] } },
      data: { occasionDate: occasionDay(30) },
    });
    await db.customer.update({
      where: { id: wrongDay.id },
      data: { occasionDate: occasionDay(29) },
    });
    const closedEnquiry = await makeEnquiry(closed.id, store.salesB.id);
    await db.enquiry.update({
      where: { id: closedEnquiry.id },
      data: { status: "SALE_COMPLETED", closedAt: new Date() },
    });
    const busyEnquiry = await makeEnquiry(busy.id, store.salesB.id);
    await db.followUp.create({
      data: {
        branchId: store.branchB.id,
        customerId: busy.id,
        enquiryId: busyEnquiry.id,
        clientId: randomUUID(),
        dueDate: calendarDay(addDays(TODAY, 3)),
        timeSlot: "EVENING",
        method: "CALL",
        assignedToId: store.salesB.id,
        createdFrom: "VISIT",
      },
    });

    expect(await createOccasionFollowUps(TODAY)).toBe(1);
    const enquiry = await db.enquiry.findFirstOrThrow({ where: { customerId: fresh.id } });
    expect(enquiry).toMatchObject({ title: "Anniversary", status: "OPEN" });
    expect(
      await db.auditLog.count({ where: { entityId: enquiry.id, action: AUDIT.enquiryCreate } }),
    ).toBe(1);
    expect(await db.followUp.count({ where: { customerId: fresh.id } })).toBe(1);
    expect(await db.followUp.count({ where: { customerId: closed.id } })).toBe(0);
    expect(await db.followUp.count({ where: { customerId: busy.id } })).toBe(1);
    expect(await db.followUp.count({ where: { customerId: wrongDay.id } })).toBe(0);
  });

  it("the lead days setting moves the day; the tick enqueues the job once from 6 AM", async () => {
    await as(store.admin.mobile);
    expect(
      await festivals.updateOccasionSettings({ occasionLeadDays: 7, campaignWeeklyLimit: 2 }),
    ).toMatchObject({ ok: true });
    expect(await occasionLeadDays()).toBe(7);
    const c = await customer(store.branchA.id, store.salesA.id);
    await db.customer.update({ where: { id: c.id }, data: { occasionDate: occasionDay(7) } });
    await makeEnquiry(c.id, store.salesA.id);
    expect(await createOccasionFollowUps(TODAY)).toBe(1);

    const D = "2033-04-12";
    await db.job.deleteMany({ where: { singletonKey: `occasion-follow-ups:${D}` } });
    const at = (hhmm: string) => new Date(`${D}T${hhmm}:00.000+05:30`);
    await tick(at("05:30"));
    expect(await db.job.count({ where: { singletonKey: `occasion-follow-ups:${D}` } })).toBe(0);
    await tick(at("06:00"));
    await tick(at("07:00"));
    expect(await db.job.count({ where: { singletonKey: `occasion-follow-ups:${D}` } })).toBe(1);
  });
});

describe("preview: who gets it and who is skipped", () => {
  it("counts consent (BR-19), the weekly limit (BR-21) and missing details; only the branch's customers", async () => {
    const hello = await template("Hello {{1}}, {{2}} for your {{3}}!");
    const yes = await customer(store.branchA.id, store.salesA.id, { occasion: "Wedding" });
    const noConsent = await customer(store.branchA.id, store.salesA.id, { consent: false });
    const noOccasion = await customer(store.branchA.id, store.salesA.id, { occasion: null });
    const limited = await customer(store.branchA.id, store.salesA.id, { occasion: "Diwali" });
    const otherBranch = await customer(store.branchB.id, store.salesB.id, { occasion: "Holi" });
    // Home branch B, but visited A: A's campaign reaches them.
    const visitor = await customer(store.branchB.id, store.salesB.id, { occasion: "Eid" });
    const enquiry = await makeEnquiry(visitor.id, store.salesB.id);
    await db.visit.create({
      data: {
        branchId: store.branchA.id,
        customerId: visitor.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        visitAt: new Date(),
        salespersonId: store.salesA.id,
        outcome: "DECIDE_LATER",
        visitType: "NEW",
      },
    });
    // Two campaign messages this week already (one failed: does not count).
    for (const status of ["SENT", "READ", "FAILED"] as const) {
      await db.whatsAppMessage.create({
        data: {
          customerId: limited.id,
          branchId: store.branchA.id,
          direction: "OUT",
          kind: "CAMPAIGN",
          status,
          body: "old campaign",
        },
      });
    }

    const preview = await previewAudience(
      {
        branchId: store.branchA.id,
        filters: { categoryIds: [] },
        template: hello,
        variables: {
          "1": { kind: "field", field: "customerFirstName" },
          "2": { kind: "text", text: "20% off" },
          "3": { kind: "field", field: "occasion" },
        },
        weeklyLimit: 2,
      },
      new Date(),
      TODAY,
    );
    expect(preview.counts).toEqual({
      matched: 5,
      noConsent: 1,
      weeklyLimit: 1,
      missingField: 1,
      ready: 2,
    });
    expect(preview.sample.map((c) => c.id).sort()).toEqual([yes.id, visitor.id].sort());
    expect(preview.sample.map((c) => c.id)).not.toContain(otherBranch.id);
    expect(preview.sample.map((c) => c.id)).not.toContain(noConsent.id);
    expect(preview.sample.map((c) => c.id)).not.toContain(noOccasion.id);
    expect(preview.recipients.find((r) => r.id === yes.id)?.values).toMatchObject({
      customerFirstName: "Asha",
      occasion: "Wedding",
      branchName: store.branchA.name,
    });
  });

  it("filters: categories, department, last visit, bought / not bought, reason, intent, occasion window", async () => {
    const hello = await template("Hi {{1}}");
    const category = await db.requirementCategory.create({
      data: { nameEn: `Sherwani ${tag}`, nameHi: "x", nameGu: "x" },
    });
    const department = await db.department.create({ data: { name: `Dept ${tag}` } });
    const reason = await db.lostReason.create({
      data: { nameEn: `Price ${tag}`, nameHi: "x", nameGu: "x" },
    });

    const sherwani = await customer(store.branchA.id, store.salesA.id, { name: "Sherwani Buyer" });
    const sherwaniEnquiry = await makeEnquiry(sherwani.id, store.salesA.id);
    await db.enquiryCategory.create({
      data: { enquiryId: sherwaniEnquiry.id, categoryId: category.id },
    });
    await db.enquiry.update({ where: { id: sherwaniEnquiry.id }, data: { intent: "HOT" } });
    await db.visit.create({
      data: {
        branchId: store.branchA.id,
        customerId: sherwani.id,
        enquiryId: sherwaniEnquiry.id,
        clientId: randomUUID(),
        visitAt: new Date("2026-06-10T06:00:00.000Z"),
        salespersonId: store.salesA.id,
        outcome: "DECIDE_LATER",
        visitType: "NEW",
      },
    });
    await db.sale.create({
      data: {
        branchId: store.branchA.id,
        customerId: sherwani.id,
        enquiryId: sherwaniEnquiry.id,
        clientId: randomUUID(),
        billNumber: `B-${tag}`,
        billDate: calendarDay("2026-06-12"),
        salespersonId: store.salesA.id,
      },
    });

    const lost = await customer(store.branchA.id, store.salesA.id, { name: "Lost Customer" });
    const lostEnquiry = await makeEnquiry(lost.id, store.salesA.id);
    await db.enquiry.update({
      where: { id: lostEnquiry.id },
      data: { status: "NOT_INTERESTED", lostReasonId: reason.id, intent: "COLD" },
    });
    await db.customer.update({
      where: { id: lost.id },
      data: { departmentId: department.id, occasionDate: calendarDay(addDays(TODAY, 5)) },
    });
    const plain = await customer(store.branchA.id, store.salesA.id, { name: "Plain" });

    const ids = async (filters: Record<string, unknown>) =>
      (
        await previewAudience(
          {
            branchId: store.branchA.id,
            filters: { categoryIds: [], ...filters },
            template: hello,
            variables: { "1": { kind: "field", field: "customerFirstName" } },
            weeklyLimit: 2,
          },
          new Date(),
          TODAY,
        )
      ).recipients
        .map((r) => r.id)
        .sort();

    expect(await ids({})).toEqual([sherwani.id, lost.id, plain.id].sort());
    expect(await ids({ categoryIds: [category.id] })).toEqual([sherwani.id]);
    expect(await ids({ departmentId: department.id })).toEqual([lost.id]);
    expect(await ids({ lastVisitFrom: "2026-06-01", lastVisitTo: "2026-06-30" })).toEqual([
      sherwani.id,
    ]);
    expect(await ids({ lastVisitFrom: "2026-07-01" })).toEqual([]);
    expect(await ids({ bought: "yes", boughtFrom: "2026-06-01", boughtTo: "2026-06-30" })).toEqual([
      sherwani.id,
    ]);
    expect(await ids({ bought: "no" })).toEqual([lost.id, plain.id].sort());
    expect(await ids({ bought: "no", boughtFrom: "2026-07-01" })).toEqual(
      [sherwani.id, lost.id, plain.id].sort(),
    );
    expect(await ids({ lostReasonId: reason.id })).toEqual([lost.id]);
    expect(await ids({ intent: "HOT" })).toEqual([sherwani.id]);
    expect(await ids({ occasionWithinDays: 10 })).toEqual([lost.id]);
    expect(await ids({ occasionWithinDays: 3 })).toEqual([]);
  });

  it("the action: a manager only for their branches, never for all; a salesperson never", async () => {
    const hello = await template("Hi {{1}}");
    await as(store.managerA.mobile);
    expect(await campaigns.previewCampaign(base(hello.id, store.branchA.id))).toMatchObject({
      ok: true,
    });
    expect(await campaigns.previewCampaign(base(hello.id, store.branchB.id))).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await campaigns.previewCampaign(base(hello.id, "all"))).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    await as(store.salesA.mobile);
    expect(await campaigns.previewCampaign(base(hello.id, store.branchA.id))).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    await as(store.admin.mobile);
    expect(await campaigns.previewCampaign(base(hello.id, "all"))).toMatchObject({ ok: true });
  });

  it("the action refuses an unapproved template and an unfilled placeholder", async () => {
    const pending = await db.whatsAppTemplate.create({
      data: {
        name: `pending_${tag}`,
        language: "en",
        category: "MARKETING",
        body: "Hi {{1}}",
        variables: ["1"],
        metaStatus: "PENDING",
      },
    });
    const two = await template("Hi {{1}} {{2}}");
    await as(store.managerA.mobile);
    expect(await campaigns.previewCampaign(base(pending.id, store.branchA.id))).toMatchObject({
      ok: false,
      message: "whatsapp.errors.templateNotApproved",
    });
    expect(await campaigns.previewCampaign(base(two.id, store.branchA.id))).toMatchObject({
      ok: false,
      message: "campaigns.errors.fillEvery",
    });
  });
});

describe("creating, running and cancelling", () => {
  it("create → SCHEDULED with its job at the scheduled time, audited; the past is refused", async () => {
    const hello = await template("Hi {{1}}");
    await as(store.managerA.mobile);
    const later = new Date(Date.now() + 60 * 60 * 1000);
    const result = await campaigns.createCampaign({
      ...base(hello.id, store.branchA.id),
      name: `Diwali ${tag}`,
      scheduledAt: later.toISOString(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(campaign).toMatchObject({
      status: "SCHEDULED",
      branchId: store.branchA.id,
      createdById: store.managerA.id,
    });
    expect(campaign.scheduledAt.getTime()).toBe(later.getTime());
    const job = await db.job.findUniqueOrThrow({
      where: { singletonKey: `campaign-send:${campaign.id}` },
    });
    expect(job.runAt.getTime()).toBe(later.getTime());
    expect(
      await db.auditLog.count({ where: { entityId: campaign.id, action: AUDIT.campaignCreate } }),
    ).toBe(1);

    expect(
      await campaigns.createCampaign({
        ...base(hello.id, store.branchA.id),
        name: "Too late",
        scheduledAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      }),
    ).toMatchObject({ ok: false, message: "campaigns.errors.schedulePast" });
  });

  it("the run: one message per consenting customer under the limit, filled, deduped; STOP in between wins; twice = once", async () => {
    const offer = await template("Hi {{1}}, {{2}}!");
    const a = await customer(store.branchA.id, store.salesA.id, { name: "Asha Patel" });
    const b = await customer(store.branchA.id, store.salesA.id, { name: "Bina Shah" });
    const stopped = await customer(store.branchA.id, store.salesA.id, { name: "Chirag Mehta" });
    const noConsent = await customer(store.branchA.id, store.salesA.id, { consent: false });
    await as(store.managerA.mobile);
    const created = await campaigns.createCampaign({
      branch: store.branchA.id,
      templateId: offer.id,
      variables: {
        "1": { kind: "field", field: "customerFirstName" },
        "2": { kind: "text", text: "20% off till Sunday" },
      },
      filters: {},
      name: `Offer ${tag}`,
    });
    if (!created.ok) throw new Error(created.message);
    // A STOP arrives after the campaign was made and before it ran.
    await db.customer.update({ where: { id: stopped.id }, data: { whatsappConsent: false } });

    expect(await runCampaign(created.data.id)).toBe(2);
    const messages = await db.whatsAppMessage.findMany({
      where: { campaignId: created.data.id },
      orderBy: { body: "asc" },
    });
    expect(messages.map((m) => m.customerId).sort()).toEqual([a.id, b.id].sort());
    expect(messages.map((m) => m.body)).toEqual([
      "Hi Asha, 20% off till Sunday!",
      "Hi Bina, 20% off till Sunday!",
    ]);
    expect(messages[0]).toMatchObject({
      kind: "CAMPAIGN",
      status: "QUEUED",
      sentById: null,
      dedupeKey: `campaign:${created.data.id}:${a.id}`,
      templateId: offer.id,
    });
    expect(await db.whatsAppMessage.count({ where: { customerId: stopped.id } })).toBe(0);
    expect(await db.whatsAppMessage.count({ where: { customerId: noConsent.id } })).toBe(0);
    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(campaign.status).toBe("DONE");
    expect(campaign.counts).toMatchObject({ matched: 4, noConsent: 2, queued: 2, weeklyLimit: 0 });
    expect(campaign.finishedAt).not.toBeNull();

    // The creator's bell.
    const rows = await db.notification.findMany({
      where: { userId: store.managerA.id, type: "campaign-done" },
    });
    expect(rows).toHaveLength(1);
    const text = (await renderNotifications(rows, "en")).get(rows[0]!.id)!;
    expect(text.title).toContain(`Offer ${tag}`);
    expect(text.body).toContain("2 messages");
    expect(text.link).toBe(`/campaigns/${created.data.id}`);

    // Run again (a retried job): nothing doubled.
    await db.campaign.update({ where: { id: created.data.id }, data: { status: "SENDING" } });
    expect(await runCampaign(created.data.id)).toBe(2);
    expect(await db.whatsAppMessage.count({ where: { campaignId: created.data.id } })).toBe(2);

    // Each message goes out through the ordinary send job, consent checked once more.
    for (const message of messages) await deliverWhatsApp(message.id, false);
    expect(
      await db.whatsAppMessage.count({ where: { campaignId: created.data.id, status: "SENT" } }),
    ).toBe(2);
  });

  it("BR-21 across campaigns: the third campaign of the week skips a customer who had two", async () => {
    const hello = await template("Hi {{1}}");
    const c = await customer(store.branchB.id, store.salesB.id);
    await as(store.managerB.mobile);
    const make = async (name: string) => {
      const result = await campaigns.createCampaign({
        ...base(hello.id, store.branchB.id),
        name: `${name} ${tag}`,
      });
      if (!result.ok) throw new Error(result.message);
      return result.data.id;
    };
    const first = await make("One");
    const second = await make("Two");
    const third = await make("Three");
    expect(await runCampaign(first)).toBe(1);
    expect(await runCampaign(second)).toBe(1);
    expect(await runCampaign(third)).toBe(0);
    expect(await db.whatsAppMessage.count({ where: { customerId: c.id, kind: "CAMPAIGN" } })).toBe(
      2,
    );
    expect((await db.campaign.findUniqueOrThrow({ where: { id: third } })).counts).toMatchObject({
      matched: 1,
      weeklyLimit: 1,
      queued: 0,
    });

    // A higher limit set by the admin applies to the next run.
    await as(store.admin.mobile);
    await festivals.updateOccasionSettings({ occasionLeadDays: 30, campaignWeeklyLimit: 3 });
    expect(await campaignWeeklyLimit()).toBe(3);
    await as(store.managerB.mobile);
    expect(await runCampaign(await make("Four"))).toBe(1);
  });

  it("results match the records: ticks, replies, visits and sales within 30 days", async () => {
    const hello = await template("Hi {{1}}");
    const read = await customer(store.branchA.id, store.salesA.id, { name: "Read Replied" });
    const visited = await customer(store.branchA.id, store.salesA.id, {
      name: "Delivered Visited",
    });
    const bought = await customer(store.branchA.id, store.salesA.id, { name: "Sent Bought" });
    const failed = await customer(store.branchA.id, store.salesA.id, { name: "Failed" });
    await as(store.managerA.mobile);
    const created = await campaigns.createCampaign({
      ...base(hello.id, store.branchA.id),
      name: `Results ${tag}`,
    });
    if (!created.ok) throw new Error(created.message);
    expect(await runCampaign(created.data.id)).toBe(4);

    const sentAt = new Date("2026-08-01T05:00:00.000Z");
    const messages = await db.whatsAppMessage.findMany({ where: { campaignId: created.data.id } });
    const of = (id: string) => messages.find((m) => m.customerId === id)!;
    await db.whatsAppMessage.updateMany({
      where: { campaignId: created.data.id },
      data: { createdAt: sentAt },
    });
    await db.whatsAppMessage.update({ where: { id: of(read.id).id }, data: { status: "READ" } });
    await db.whatsAppMessage.update({
      where: { id: of(visited.id).id },
      data: { status: "DELIVERED" },
    });
    await db.whatsAppMessage.update({ where: { id: of(bought.id).id }, data: { status: "SENT" } });
    await db.whatsAppMessage.update({
      where: { id: of(failed.id).id },
      data: { status: "FAILED" },
    });

    const after = (days: number) => new Date(sentAt.getTime() + days * 86_400_000);
    // A reply the next day; a visit 10 days later; a sale 20 days later; and things that
    // must not count: a visit before, a sale 31 days later, a cancelled sale.
    await db.whatsAppMessage.create({
      data: {
        customerId: read.id,
        branchId: store.branchA.id,
        direction: "IN",
        kind: "INCOMING",
        status: "READ",
        body: "Yes please",
        createdAt: after(1),
      },
    });
    const visitEnquiry = await makeEnquiry(visited.id, store.salesA.id);
    const visitRow = (customerId: string, enquiryId: string, at: Date) =>
      db.visit.create({
        data: {
          branchId: store.branchA.id,
          customerId,
          enquiryId,
          clientId: randomUUID(),
          visitAt: at,
          salespersonId: store.salesA.id,
          outcome: "DECIDE_LATER",
          visitType: "EXISTING",
        },
      });
    await visitRow(visited.id, visitEnquiry.id, after(10));
    const boughtEnquiry = await makeEnquiry(bought.id, store.salesA.id);
    await visitRow(bought.id, boughtEnquiry.id, after(-2));
    const sale = (customerId: string, enquiryId: string, at: Date, cancelled = false) =>
      db.sale.create({
        data: {
          branchId: store.branchA.id,
          customerId,
          enquiryId,
          clientId: randomUUID(),
          billNumber: `R-${randomUUID().slice(0, 6)}`,
          billDate: calendarDay(isoDate(at)),
          salespersonId: store.salesA.id,
          createdAt: at,
          cancelled,
        },
      });
    await sale(bought.id, boughtEnquiry.id, after(20));
    await sale(visited.id, visitEnquiry.id, after(31));
    const readEnquiry = await makeEnquiry(read.id, store.salesA.id);
    await sale(read.id, readEnquiry.id, after(5), true);

    const { totals, recipients } = await campaignResults(created.data.id);
    expect(totals).toEqual({
      recipients: 4,
      waiting: 0,
      sent: 3,
      delivered: 2,
      read: 1,
      failed: 1,
      replied: 1,
      visited: 1,
      bought: 1,
    });
    const row = (id: string) => recipients.find((r) => r.customerId === id)!;
    expect(row(read.id)).toMatchObject({
      status: "READ",
      replied: true,
      visited: false,
      bought: false,
    });
    expect(row(visited.id)).toMatchObject({ status: "DELIVERED", visited: true, bought: false });
    expect(row(bought.id)).toMatchObject({ status: "SENT", visited: false, bought: true });
    expect(row(failed.id)).toMatchObject({ status: "FAILED", replied: false });

    // The same numbers on R10 and the campaign page.
    const manager = await as(store.managerA.mobile, store.branchA.id);
    const detail = await loadCampaign(
      { all: false, branchIds: [store.branchA.id] },
      created.data.id,
    );
    expect(detail?.results.totals).toEqual(totals);
    const day = isoDate(new Date());
    const r10 = await runReport(manager, "r10", { from: day, to: day }, "en");
    const campaignsTable = r10!.result.tables.find((table) => table.key === "campaigns")!;
    const line = campaignsTable.rows.find((r) => r.cells["campaign"] === `Results ${tag}`)!;
    expect(line.cells).toMatchObject({
      recipients: 4,
      sent: 3,
      delivered: 2,
      read: 1,
      replied: 1,
      visited: 1,
      bought: 1,
    });
    expect(line.href).toBe(`/campaigns/${created.data.id}`);
  });

  it("cancel: only while SCHEDULED, only in your branches; an all-branches campaign is the admin's", async () => {
    const hello = await template("Hi {{1}}");
    await customer(store.branchA.id, store.salesA.id);
    await as(store.managerA.mobile);
    const mine = await campaigns.createCampaign({
      ...base(hello.id, store.branchA.id),
      name: `Mine ${tag}`,
    });
    if (!mine.ok) throw new Error(mine.message);
    await as(store.admin.mobile);
    const everyone = await campaigns.createCampaign({
      ...base(hello.id, "all"),
      name: `All ${tag}`,
    });
    if (!everyone.ok) throw new Error(everyone.message);

    await as(store.managerB.mobile);
    expect(await campaigns.cancelCampaign({ id: mine.data.id })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await campaigns.cancelCampaign({ id: everyone.data.id })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });

    await as(store.managerA.mobile);
    expect(await campaigns.cancelCampaign({ id: mine.data.id })).toMatchObject({ ok: true });
    const cancelled = await db.campaign.findUniqueOrThrow({ where: { id: mine.data.id } });
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelledById: store.managerA.id });
    expect(
      await db.auditLog.count({ where: { entityId: mine.data.id, action: AUDIT.campaignCancel } }),
    ).toBe(1);
    // The worker finds nothing to do, and nobody gets a message.
    expect(await runCampaign(mine.data.id)).toBeNull();
    expect(await db.whatsAppMessage.count({ where: { campaignId: mine.data.id } })).toBe(0);
    expect(await campaigns.cancelCampaign({ id: mine.data.id })).toMatchObject({
      ok: false,
      message: "campaigns.errors.notScheduled",
    });

    await as(store.admin.mobile);
    expect(await campaigns.cancelCampaign({ id: everyone.data.id })).toMatchObject({ ok: true });
  });

  it("the list: a manager sees their branches' campaigns and the all-branches ones; the admin on All sees every one", async () => {
    const hello = await template("Hi {{1}}");
    await as(store.managerA.mobile);
    const a = await campaigns.createCampaign({
      ...base(hello.id, store.branchA.id),
      name: `A ${tag}`,
    });
    await as(store.managerB.mobile);
    const b = await campaigns.createCampaign({
      ...base(hello.id, store.branchB.id),
      name: `B ${tag}`,
    });
    await as(store.admin.mobile);
    const all = await campaigns.createCampaign({ ...base(hello.id, "all"), name: `All ${tag}` });
    if (!a.ok || !b.ok || !all.ok) throw new Error("create failed");

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    const forA = ids(await listCampaigns({ all: false, branchIds: [store.branchA.id] }));
    expect(forA).toContain(a.data.id);
    expect(forA).toContain(all.data.id);
    expect(forA).not.toContain(b.data.id);
    const forAdmin = ids(await listCampaigns({ all: true }));
    expect(forAdmin).toEqual(expect.arrayContaining([a.data.id, b.data.id, all.data.id]));
    expect(await loadCampaign({ all: false, branchIds: [store.branchB.id] }, a.data.id)).toBeNull();
    expect(
      (await loadCampaign({ all: false, branchIds: [store.branchB.id] }, all.data.id))?.branchName,
    ).toBeNull();
  });

  it("speed: the preview over 2,000 customers of a branch", async () => {
    const hello = await template("Hi {{1}}");
    await db.customer.createMany({
      data: Array.from({ length: 2000 }, (_, i) => ({
        name: `Perf ${tag} ${i}`,
        mobile: `8${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`,
        assignedToId: store.salesB.id,
        homeBranchId: store.branchB.id,
        whatsappConsent: i % 4 !== 0,
      })),
      skipDuplicates: true,
    });
    const started = performance.now();
    const preview = await previewAudience(
      {
        branchId: store.branchB.id,
        filters: { categoryIds: [] },
        template: hello,
        variables: { "1": { kind: "field", field: "customerFirstName" } },
        weeklyLimit: 2,
      },
      new Date(),
      TODAY,
    );
    const took = performance.now() - started;
    expect(preview.counts.matched).toBeGreaterThanOrEqual(1990);
    expect(took).toBeLessThan(3000);
    console.log(
      `campaign preview over ${preview.counts.matched} customers: ${Math.round(took)} ms`,
    );
  });
});

describe("festival calendar and settings (admin)", () => {
  it("add, edit and confirm, remove (switched off, audited); pre-fill adds each festival once", async () => {
    await as(store.admin.mobile);
    const added = await festivals.addFestival({
      name: `Store Day ${tag}`,
      date: "2026-12-01",
      branch: store.branchA.id,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    let row = await db.festival.findUniqueOrThrow({ where: { id: added.data.id } });
    expect(row).toMatchObject({ branchId: store.branchA.id, confirmed: true, active: true });
    expect(isoDate(row.date)).toBe("2026-12-01");

    expect(
      await festivals.updateFestival({
        id: added.data.id,
        name: `Store Day ${tag}`,
        date: "2026-12-02",
        branch: "all",
        confirmed: true,
      }),
    ).toMatchObject({ ok: true });
    row = await db.festival.findUniqueOrThrow({ where: { id: added.data.id } });
    expect(row.branchId).toBeNull();
    expect(isoDate(row.date)).toBe("2026-12-02");

    expect(await festivals.removeFestival({ id: added.data.id })).toMatchObject({ ok: true });
    row = await db.festival.findUniqueOrThrow({ where: { id: added.data.id } });
    expect(row.active).toBe(false);
    expect(
      await db.auditLog.count({ where: { entityId: added.data.id, action: AUDIT.festivalRemove } }),
    ).toBe(1);
    expect(await festivals.removeFestival({ id: added.data.id })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      await festivals.addFestival({
        name: "Nowhere",
        date: "2026-12-01",
        branch: "no-such-branch",
      }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });

    const first = await festivals.prefillCommonFestivals({});
    expect(first.ok).toBe(true);
    const second = await festivals.prefillCommonFestivals({});
    expect(second).toMatchObject({ ok: true, data: { added: 0 } });
    const diwali = await db.festival.findFirst({
      where: { name: "Diwali", date: calendarDay("2026-11-08"), active: true },
    });
    expect(diwali).toMatchObject({ branchId: null, confirmed: false });
  });

  it("managers and salespeople cannot touch the calendar or the settings", async () => {
    await as(store.managerA.mobile);
    expect(
      await festivals.addFestival({ name: "X", date: "2026-12-01", branch: "all" }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await festivals.updateOccasionSettings({ occasionLeadDays: 10, campaignWeeklyLimit: 1 }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await as(store.salesA.mobile);
    expect(await festivals.prefillCommonFestivals({})).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await occasionLeadDays()).toBe(30);
  });

  it("settings: audited, refused out of range", async () => {
    await as(store.admin.mobile);
    expect(
      await festivals.updateOccasionSettings({ occasionLeadDays: 91, campaignWeeklyLimit: 2 }),
    ).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(
      await festivals.updateOccasionSettings({ occasionLeadDays: 15, campaignWeeklyLimit: 1 }),
    ).toMatchObject({ ok: true });
    expect(await occasionLeadDays()).toBe(15);
    expect(await campaignWeeklyLimit()).toBe(1);
    const audit = await db.auditLog.findFirst({
      where: { action: AUDIT.settingUpdate, entityId: { contains: SETTING.occasionLeadDays } },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.newValue).toEqual({ occasionLeadDays: 15, campaignWeeklyLimit: 1 });
  });

  it("R10 as a manager: message counts by type for the period, own branch only", async () => {
    const day = isoDate(new Date());
    const c = await customer(store.branchA.id, store.salesA.id);
    const other = await customer(store.branchB.id, store.salesB.id);
    const rows = [
      { customerId: c.id, branchId: store.branchA.id, kind: "TEMPLATE", status: "READ" },
      { customerId: c.id, branchId: store.branchA.id, kind: "TEMPLATE", status: "FAILED" },
      { customerId: c.id, branchId: store.branchA.id, kind: "CAMPAIGN", status: "SENT" },
      { customerId: other.id, branchId: store.branchB.id, kind: "CAMPAIGN", status: "READ" },
    ] as const;
    for (const row of rows) {
      await db.whatsAppMessage.create({ data: { ...row, direction: "OUT", body: "x" } });
    }
    await db.whatsAppMessage.create({
      data: {
        customerId: c.id,
        branchId: store.branchA.id,
        direction: "IN",
        kind: "INCOMING",
        status: "READ",
        body: "hi",
      },
    });
    const manager = await as(store.managerA.mobile, store.branchA.id);
    const r10 = await runReport(manager, "r10", { from: day, to: day }, "en");
    const kinds = r10!.result.tables.find((table) => table.key === "kinds")!;
    const cells = (kind: string) => kinds.rows.find((r) => r.cells["kind"] === kind)!.cells;
    expect(cells("Sent by staff (template)")).toMatchObject({
      messages: 2,
      sent: 1,
      read: 1,
      failed: 1,
    });
    expect(cells("Campaign")).toMatchObject({ messages: 1, sent: 1, delivered: 0 });
    expect(cells("Replies from customers")).toMatchObject({ messages: 1 });
    expect(kinds.totals).toMatchObject({ messages: 4, sent: 2, failed: 1 });
    expect(await runReport(await as(store.salesA.mobile), "r10", {}, "en")).toBeNull();
    const admin = await as(store.admin.mobile, ALL_BRANCHES);
    const all = (await runReport(admin, "r10", { from: day, to: day }, "en"))!.result.tables[0]!;
    expect(
      all.rows.find((r) => r.cells["kind"] === "Campaign")!.cells["messages"],
    ).toBeGreaterThanOrEqual(2);
  });
});
