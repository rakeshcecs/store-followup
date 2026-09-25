import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const festivals = await import("@/lib/actions/festival");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { requireUser } = await import("@/lib/auth");
const { createOccasionFollowUps } = await import("@/lib/occasions");
const { occasionLeadDays, SETTING } = await import("@/lib/settings");
const { calendarDay } = await import("@/lib/follow-ups");
const { addDays } = await import("@/lib/follow-up-dates");
const { isoDate } = await import("@/lib/format");
const { tick } = await import("../../worker/schedules");
const { makeCustomer, makeEnquiry } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs, viewingBranch } = await import("../helpers/session");

type TestStore = Awaited<ReturnType<typeof makeStore>>;

// M23 on the two-branch store: the 6 AM occasion follow-ups, the festival calendar and
// its lead-days setting. (Campaigns and WhatsApp messaging were dropped on 25 Sep 2026.)

let store: TestStore;
let tag: string;
const TODAY = isoDate(new Date());

beforeEach(async () => {
  store = await makeStore();
  tag = randomUUID().slice(0, 8);
  // The default, whatever an earlier test set.
  await db.setting.deleteMany({ where: { key: SETTING.occasionLeadDays } });
});

afterAll(() => db.$disconnect());

async function customer(
  branchId: string,
  assignedToId: string,
  data: { name?: string; occasion?: string | null } = {},
) {
  const row = await makeCustomer(branchId, assignedToId);
  return db.customer.update({
    where: { id: row.id },
    data: { name: data.name ?? `Asha ${tag}`, occasion: data.occasion ?? null },
  });
}

const as = async (mobile: string, branch?: string) => {
  await signInAs(mobile);
  if (branch) viewingBranch(branch);
  return requireUser();
};

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
      await festivals.updateOccasionSettings({ occasionLeadDays: 7 }),
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
      await festivals.updateOccasionSettings({ occasionLeadDays: 10 }),
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
    expect(await festivals.updateOccasionSettings({ occasionLeadDays: 91 })).toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
    expect(await festivals.updateOccasionSettings({ occasionLeadDays: 15 })).toMatchObject({
      ok: true,
    });
    expect(await occasionLeadDays()).toBe(15);
    const audit = await db.auditLog.findFirst({
      where: { action: AUDIT.settingUpdate, entityId: { contains: SETTING.occasionLeadDays } },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.newValue).toEqual({ occasionLeadDays: 15 });
  });

});
