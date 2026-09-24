import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setFollowUp } = await import("@/lib/actions/follow-up");
const { recordVisit } = await import("@/lib/actions/visit");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { TIMELINE } = await import("@/lib/timeline");
const { customerTimeline } = await import("@/lib/customers");
const { isoDate } = await import("@/lib/format");
const { ALL_BRANCHES } = await import("@/lib/permissions");
const { makeCustomer, makeEnquiry } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
const { signInAs, viewingBranch } = await import("../helpers/session");

// M08: a follow-up from the profile (setFollowUp) and with a "decide later" visit
// (recordVisit). Two branches, two managers, two salespeople and an admin, every time.
let store: TestStore;
let customer: Awaited<ReturnType<typeof makeCustomer>>;

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => isoDate(new Date(Date.now() + offset * DAY));

const onProfile = (extra: Record<string, unknown> = {}) => ({
  clientId: randomUUID(),
  customerId: customer.id,
  followUp: { dueDate: day(2), timeSlot: "EVENING", method: "CALL", ...extra },
});

async function followUpOf(result: Awaited<ReturnType<typeof setFollowUp>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code} ${result.message}`);
  return db.followUp.findUniqueOrThrow({ where: { id: result.data.followUpId } });
}

const pendingCount = () =>
  db.followUp.count({ where: { customerId: customer.id, status: "PENDING" } });

beforeEach(async () => {
  store = await makeStore();
  customer = await makeCustomer(store.branchA.id, store.salesA.id);
  await signInAs(store.salesA.mobile);
});

afterAll(() => db.$disconnect());

describe("setFollowUp — Follow-up from the profile (M08.07)", () => {
  it("adds the follow-up to the open enquiry", async () => {
    const enquiry = await makeEnquiry(customer.id, store.salesA.id);

    const row = await followUpOf(
      await setFollowUp(onProfile({ method: "WHATSAPP", reason: " Send the new designs " })),
    );

    expect(row.status).toBe("PENDING");
    expect(row.enquiryId).toBe(enquiry.id);
    expect(row.branchId).toBe(store.branchA.id);
    expect(isoDate(row.dueDate)).toBe(day(2));
    expect(row.timeSlot).toBe("EVENING");
    expect(row.method).toBe("WHATSAPP");
    expect(row.reason).toBe("Send the new designs");
    expect(row.createdFrom).toBe("PROFILE");
  });

  it("goes to the customer's salesperson, whoever sets it (M08.08)", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    await signInAs(store.managerA.mobile);

    const row = await followUpOf(await setFollowUp(onProfile()));

    expect(row.assignedToId).toBe(store.salesA.id);
  });

  it("refuses when there is no open enquiry — a follow-up starts with a visit", async () => {
    await expect(setFollowUp(onProfile())).resolves.toMatchObject({
      ok: false,
      code: "RULE",
      message: "followUps.errors.noOpenEnquiry",
    });
  });

  it("refuses a date in the past, and takes today (BR-08, M08.05)", async () => {
    await makeEnquiry(customer.id, store.salesA.id);

    await expect(setFollowUp(onProfile({ dueDate: day(-1) }))).resolves.toMatchObject({
      ok: false,
      field: "followUp.dueDate",
      message: "visits.errors.dueDatePast",
    });
    expect(await pendingCount()).toBe(0);
    expect((await setFollowUp(onProfile({ dueDate: day(0) }))).ok).toBe(true);
  });

  it("needs a time slot and a method (M08.02, M08.03)", async () => {
    await makeEnquiry(customer.id, store.salesA.id);

    await expect(setFollowUp(onProfile({ timeSlot: undefined }))).resolves.toMatchObject({
      ok: false,
    });
    await expect(setFollowUp(onProfile({ method: "EMAIL" }))).resolves.toMatchObject({
      ok: false,
    });
  });

  it("writes the history row pointing at the follow-up, and the audit row", async () => {
    await makeEnquiry(customer.id, store.salesA.id);

    const row = await followUpOf(await setFollowUp(onProfile({ reason: "Call after 6" })));

    const event = await db.timelineEvent.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(event.type).toBe(TIMELINE.followUpSet.type);
    expect(event.detail).toBe("Call after 6");
    expect(event.entityId).toBe(row.id);
    expect(event.branchId).toBe(store.branchA.id);
    expect(
      await db.auditLog.count({ where: { entityId: row.id, action: AUDIT.followUpCreate } }),
    ).toBe(1);

    // The profile shows "Follow-up set for …" from the follow-up it points at.
    const { events } = await customerTimeline(customer.id, 10);
    expect(events[0]?.followUp).toMatchObject({ timeSlot: "EVENING" });
    expect(isoDate(events[0]!.followUp!.dueDate)).toBe(day(2));
  });

  it("sets a follow-up once, however many times it is sent", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    const input = onProfile();

    const [first, again] = await Promise.all([setFollowUp(input), setFollowUp(input)]);
    const later = await setFollowUp(input);

    expect(first.ok && again.ok && later.ok).toBe(true);
    if (first.ok && again.ok && later.ok) {
      expect(
        new Set([first.data.followUpId, again.data.followUpId, later.data.followUpId]).size,
      ).toBe(1);
    }
    expect(await db.followUp.count({ where: { customerId: customer.id } })).toBe(1);
  });
});

describe("one pending follow-up per customer (BR-02, M08.06)", () => {
  it("replaces the pending one, marking it Rescheduled, and audits both", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    const old = await followUpOf(await setFollowUp(onProfile()));

    const row = await followUpOf(await setFollowUp(onProfile({ dueDate: day(5) })));

    expect((await db.followUp.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "RESCHEDULED",
    );
    expect(row.status).toBe("PENDING");
    expect(await pendingCount()).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: old.id, action: AUDIT.followUpReschedule },
    });
    expect(audit.newValue).toMatchObject({ status: "RESCHEDULED", replacedBy: row.id });
  });

  it("replaces one set in another branch — the rule is store-wide", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    const old = await followUpOf(await setFollowUp(onProfile()));
    await signInAs(store.salesB.mobile);

    const row = await followUpOf(await setFollowUp(onProfile()));

    expect(row.branchId).toBe(store.branchB.id);
    expect((await db.followUp.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "RESCHEDULED",
    );
  });

  it("never leaves two pending when two are set at the same moment", async () => {
    await makeEnquiry(customer.id, store.salesA.id);

    const results = await Promise.all([
      setFollowUp(onProfile({ dueDate: day(1) })),
      setFollowUp(onProfile({ dueDate: day(3) })),
      setFollowUp(onProfile({ dueDate: day(4) })),
    ]);

    expect(results.some((result) => result.ok)).toBe(true);
    expect(await pendingCount()).toBe(1);
  });

  it("the visit's follow-up replaces a pending one too, and its history row points at it", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    const old = await followUpOf(await setFollowUp(onProfile()));
    const category = await db.requirementCategory.create({
      data: { nameEn: "Sherwani", nameHi: "Sherwani", nameGu: "Sherwani", sortOrder: 1 },
    });

    const result = await recordVisit({
      clientId: randomUUID(),
      customerId: customer.id,
      categoryIds: [category.id],
      outcome: "DECIDE_LATER",
      followUp: { dueDate: day(3), timeSlot: "MORNING", method: "VISIT" },
    });

    expect(result.ok).toBe(true);
    const row = await db.followUp.findFirstOrThrow({
      where: { customerId: customer.id, status: "PENDING" },
    });
    expect(row.createdFrom).toBe("VISIT");
    expect(
      await db.auditLog.count({ where: { entityId: old.id, action: AUDIT.followUpReschedule } }),
    ).toBe(1);
    const event = await db.timelineEvent.findFirstOrThrow({
      where: { customerId: customer.id, type: TIMELINE.followUpSet.type, entityId: row.id },
    });
    expect(event.branchId).toBe(store.branchA.id);
  });
});

describe("branches (BR-16, M17)", () => {
  it("files the follow-up under the branch on screen", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    await signInAs(store.admin.mobile);
    viewingBranch(store.branchB.id);

    const row = await followUpOf(await setFollowUp(onProfile()));

    expect(row.branchId).toBe(store.branchB.id);
  });

  it("cannot be filed under a branch the person does not work in", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    viewingBranch(store.branchB.id); // a tampered switcher cookie

    const row = await followUpOf(await setFollowUp(onProfile()));

    expect(row.branchId).toBe(store.branchA.id);
  });

  it("makes an admin on All branches pick one first", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    await signInAs(store.admin.mobile);
    viewingBranch(ALL_BRANCHES);

    await expect(setFollowUp(onProfile())).resolves.toMatchObject({
      ok: false,
      message: "branch.errors.pickOne",
    });
  });

  it("refuses someone who is not signed in", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    await signInAs(null);

    await expect(setFollowUp(onProfile())).resolves.toMatchObject({ ok: false });
    expect(await pendingCount()).toBe(0);
  });
});
