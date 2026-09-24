import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
// No real push service in tests: record what would be sent, and fail on demand.
const sendNotification = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

const { db } = await import("@/lib/db");
const { calendarDay } = await import("@/lib/follow-ups");
const { createManagerSummaries, createMorningSummaries, createSlotReminders, NOTIFICATION } =
  await import("@/lib/reminders");
const { renderNotifications } = await import("@/lib/notification-text");
const { pushPending, resetPushConfig } = await import("@/lib/push");
const { markAllRead, subscribePush } = await import("@/lib/actions/notifications");
const { logout } = await import("@/lib/actions/auth");
const { updateReminderSettings } = await import("@/lib/actions/settings");
const { reminderTimes, SETTING } = await import("@/lib/settings");
const { DEFAULT_REMINDER_TIMES } = await import("@/lib/validation/reminders");
const { AUDIT } = await import("@/lib/audit");
const { tick } = await import("../../worker/schedules");
const { makeCustomer, makeEnquiry, makeUser } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs } = await import("../helpers/session");

type TestStore = Awaited<ReturnType<typeof makeStore>>;

// M14 on a fixed day nobody else uses, with two branches, two managers, two salespeople
// and an admin every time.
const D = "2032-05-18";
const DAY_BEFORE = "2032-05-17";
let store: TestStore;

async function followUp(options: {
  assignedToId: string;
  branchId: string;
  due: string;
  slot?: "MORNING" | "AFTERNOON" | "EVENING";
  status?: "PENDING" | "DONE" | "CANCELLED";
  name?: string;
  createdAt?: Date;
}) {
  const customer = await makeCustomer(options.branchId, options.assignedToId);
  if (options.name) {
    await db.customer.update({ where: { id: customer.id }, data: { name: options.name } });
  }
  const enquiry = await makeEnquiry(customer.id, options.assignedToId);
  return db.followUp.create({
    data: {
      branchId: options.branchId,
      customerId: customer.id,
      enquiryId: enquiry.id,
      clientId: randomUUID(),
      dueDate: calendarDay(options.due),
      timeSlot: options.slot ?? "EVENING",
      method: "CALL",
      assignedToId: options.assignedToId,
      createdFrom: "VISIT",
      status: options.status ?? "PENDING",
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
}

const mine = (userId: string, type: string) =>
  db.notification.findMany({ where: { userId, type, message: { contains: D } } });

beforeEach(async () => {
  store = await makeStore();
  sendNotification.mockReset();
});

describe("morning summary (M14.02)", () => {
  it("counts only the salesperson's own follow-ups, and skips someone with none", async () => {
    const a = { assignedToId: store.salesA.id, branchId: store.branchA.id };
    await followUp({ ...a, due: D });
    await followUp({ ...a, due: D, slot: "MORNING" });
    await followUp({ ...a, due: DAY_BEFORE }); // overdue
    await followUp({ ...a, due: D, status: "DONE" }); // not pending: not counted
    // salesA's follow-up filed in the other branch still counts (BR-16).
    await followUp({ assignedToId: store.salesA.id, branchId: store.branchB.id, due: D });

    await createMorningSummaries(D);

    const [row] = await mine(store.salesA.id, NOTIFICATION.morning);
    expect(row?.message).toBe(`${NOTIFICATION.morning}:${D}:3:1`);
    expect(row?.link).toBe("/today");
    expect(await mine(store.salesB.id, NOTIFICATION.morning)).toHaveLength(0);
  });

  it("goes to salespeople only, and not to someone deactivated", async () => {
    const quit = await makeUser({ role: "SALESPERSON", homeBranchId: store.branchA.id });
    await db.user.update({ where: { id: quit.id }, data: { status: "INACTIVE" } });
    await followUp({ assignedToId: quit.id, branchId: store.branchA.id, due: D });
    await followUp({ assignedToId: store.managerA.id, branchId: store.branchA.id, due: D });

    await createMorningSummaries(D);

    expect(await mine(quit.id, NOTIFICATION.morning)).toHaveLength(0);
    expect(await mine(store.managerA.id, NOTIFICATION.morning)).toHaveLength(0);
  });

  it("is written once however often the job runs", async () => {
    await followUp({ assignedToId: store.salesA.id, branchId: store.branchA.id, due: D });
    await createMorningSummaries(D);
    await createMorningSummaries(D);
    expect(await mine(store.salesA.id, NOTIFICATION.morning)).toHaveLength(1);
  });
});

describe("slot reminders (M14.03)", () => {
  it("lists that slot's follow-ups for today, oldest first, two names and a count", async () => {
    const a = { assignedToId: store.salesA.id, branchId: store.branchA.id, due: D };
    const first = await followUp({
      ...a,
      name: "Rajesh Patel",
      createdAt: new Date("2032-05-01T00:00:00Z"),
    });
    const second = await followUp({
      ...a,
      name: "Neha Shah",
      createdAt: new Date("2032-05-02T00:00:00Z"),
    });
    await followUp({ ...a, name: "Kiran Rao", createdAt: new Date("2032-05-03T00:00:00Z") });
    await followUp({ ...a, slot: "MORNING", name: "Morning Only" });
    await followUp({ ...a, due: DAY_BEFORE, name: "Overdue One" }); // not today

    await createSlotReminders(D, "EVENING");

    const [row] = await mine(store.salesA.id, NOTIFICATION.slot);
    expect(row?.message).toBe(`${NOTIFICATION.slot}:${D}:EVENING:3:${first.id},${second.id}`);
    expect(row?.link).toBe("/today");
    const text = (await renderNotifications([row!], "en")).get(row!.id);
    expect(text).toMatchObject({
      title: "Evening follow-ups",
      body: "Rajesh Patel, Neha Shah and 1 more",
    });
  });

  it("opens the follow-up itself when there is only one, and never lists another's", async () => {
    const only = await followUp({
      assignedToId: store.salesB.id,
      branchId: store.branchB.id,
      due: D,
      slot: "AFTERNOON",
      name: "Lata Thakkar",
    });

    await createSlotReminders(D, "AFTERNOON");

    const [row] = await mine(store.salesB.id, NOTIFICATION.slot);
    expect(row?.link).toBe(`/follow-ups/${only.id}`);
    expect((await renderNotifications([row!], "en")).get(row!.id)?.body).toBe("Lata Thakkar");
    expect(await mine(store.salesA.id, NOTIFICATION.slot)).toHaveLength(0);
  });
});

describe("manager summary (M14.04)", () => {
  async function dayIn(branchId: string, salespersonId: string, visits: number, sales: number) {
    for (let i = 0; i < visits; i += 1) {
      const customer = await makeCustomer(branchId, salespersonId);
      const enquiry = await makeEnquiry(customer.id, salespersonId);
      await db.visit.create({
        data: {
          branchId,
          customerId: customer.id,
          enquiryId: enquiry.id,
          clientId: randomUUID(),
          visitAt: new Date(`${D}T11:00:00.000+05:30`),
          salespersonId,
          outcome: "DECIDE_LATER",
          visitType: "NEW",
        },
      });
      if (i < sales) {
        await db.sale.create({
          data: {
            branchId,
            customerId: customer.id,
            enquiryId: enquiry.id,
            clientId: randomUUID(),
            billNumber: `M14-${randomUUID().slice(0, 8)}`,
            billDate: calendarDay(D),
            salespersonId,
          },
        });
      }
    }
  }

  it("gives each manager their own branch's numbers, one per branch they work in", async () => {
    await dayIn(store.branchA.id, store.salesA.id, 3, 1);
    await dayIn(store.branchB.id, store.salesB.id, 1, 0);
    const a = { assignedToId: store.salesA.id, branchId: store.branchA.id };
    await followUp({ ...a, due: D, status: "DONE" });
    await followUp({ ...a, due: D });
    await followUp({ ...a, due: D, status: "CANCELLED" }); // no longer due
    await followUp({ ...a, due: DAY_BEFORE }); // overdue
    await followUp({ assignedToId: store.salesB.id, branchId: store.branchB.id, due: D });
    const both = await makeUser({
      role: "MANAGER",
      homeBranchId: store.branchA.id,
      extraBranchIds: [store.branchB.id],
    });

    await createManagerSummaries(D);

    const branchA = `${NOTIFICATION.manager}:${D}:${store.branchA.id}:3:1:1:2:1`;
    const branchB = `${NOTIFICATION.manager}:${D}:${store.branchB.id}:1:0:0:1:0`;
    expect((await mine(store.managerA.id, NOTIFICATION.manager)).map((r) => r.message)).toEqual([
      branchA,
    ]);
    expect((await mine(store.managerB.id, NOTIFICATION.manager)).map((r) => r.message)).toEqual([
      branchB,
    ]);
    expect((await mine(both.id, NOTIFICATION.manager)).map((r) => r.message).sort()).toEqual(
      [branchA, branchB].sort(),
    );
    // Salespeople get none.
    expect(await mine(store.salesA.id, NOTIFICATION.manager)).toHaveLength(0);
  });

  it("gives the admin one all-branches total", async () => {
    await dayIn(store.branchA.id, store.salesA.id, 2, 1);
    await dayIn(store.branchB.id, store.salesB.id, 1, 1);

    await createManagerSummaries(D);

    const rows = await mine(store.admin.id, NOTIFICATION.manager);
    expect(rows).toHaveLength(1);
    const [, , where, visits, sales] = rows[0]!.message.split(":");
    expect(where).toBe("all");
    // Every branch that day, counted straight from the tables (earlier tests in this
    // file add to the same day, and no other file uses it).
    const allVisits = await db.visit.count({
      where: {
        visitAt: {
          gte: new Date(`${D}T00:00:00.000+05:30`),
          lt: new Date(`${D}T23:59:59.999+05:30`),
        },
      },
    });
    const allSales = await db.sale.count({ where: { billDate: calendarDay(D), cancelled: false } });
    expect([Number(visits), Number(sales)]).toEqual([allVisits, allSales]);
    expect(allVisits).toBeGreaterThanOrEqual(3);
    const text = (await renderNotifications(rows, "en")).get(rows[0]!.id);
    expect(text?.title).toBe("Today at all branches");
    expect(text?.link).toBe("/overview");
  });
});

describe("push (Web Push)", () => {
  beforeEach(async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    resetPushConfig();
    // Only this test's rows are waiting.
    await db.notification.updateMany({ where: { pushedAt: null }, data: { pushedAt: new Date() } });
  });

  async function device(userId: string) {
    return db.pushSubscription.create({
      data: {
        userId,
        endpoint: `https://push.example/${randomUUID()}`,
        keys: { p256dh: "p", auth: "a" },
      },
    });
  }
  const alert = (userId: string) =>
    db.notification.create({
      data: {
        userId,
        type: NOTIFICATION.morning,
        message: `${NOTIFICATION.morning}:${D}:2:0`,
        link: "/today",
      },
    });

  it("sends each waiting notification to every device of its person, once", async () => {
    await device(store.salesA.id);
    await device(store.salesA.id);
    await device(store.salesB.id); // not theirs: gets nothing
    const row = await alert(store.salesA.id);

    expect(await pushPending()).toBe(2);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(sendNotification.mock.calls[0]![1] as string);
    expect(payload).toMatchObject({ title: "Today's follow-ups", link: "/today", tag: row.id });

    expect(await pushPending()).toBe(0); // already pushed
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("drops a device the push service no longer knows, and keeps going", async () => {
    const gone = await device(store.salesA.id);
    const fine = await device(store.salesA.id);
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === gone.endpoint)
        throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    await alert(store.salesA.id);

    expect(await pushPending()).toBe(1);
    expect(await db.pushSubscription.findUnique({ where: { id: gone.id } })).toBeNull();
    expect(await db.pushSubscription.findUnique({ where: { id: fine.id } })).not.toBeNull();
  });

  it("does nothing without VAPID keys; the bell still has the row", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    resetPushConfig();
    await device(store.salesA.id);
    const row = await alert(store.salesA.id);

    expect(await pushPending()).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: row.id } })).pushedAt,
    ).toBeNull();
  });
});

describe("device subscription and the bell (actions)", () => {
  const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "p", auth: "a" } });

  it("saves this device for whoever is signed in, and moves it when the phone changes hands", async () => {
    const endpoint = `https://push.example/${randomUUID()}`;
    await signInAs(store.salesA.mobile);
    expect(await subscribePush(sub(endpoint))).toMatchObject({ ok: true });
    await signInAs(store.salesB.mobile);
    await subscribePush(sub(endpoint));

    const rows = await db.pushSubscription.findMany({ where: { endpoint } });
    expect(rows.map((r) => r.userId)).toEqual([store.salesB.id]);
  });

  it("stops this device's reminders on logout", async () => {
    const endpoint = `https://push.example/${randomUUID()}`;
    await signInAs(store.salesA.mobile);
    await subscribePush(sub(endpoint));
    await logout({});
    expect(await db.pushSubscription.findUnique({ where: { endpoint } })).toBeNull();
  });

  it("marks only your own notifications read", async () => {
    const own = await db.notification.create({
      data: { userId: store.salesA.id, type: "t", message: "t", link: "/" },
    });
    const other = await db.notification.create({
      data: { userId: store.salesB.id, type: "t", message: "t", link: "/" },
    });
    await signInAs(store.salesA.mobile);
    await markAllRead({});

    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: own.id } })).readAt,
    ).not.toBeNull();
    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt,
    ).toBeNull();
  });
});

describe("reminder settings (admin)", () => {
  beforeEach(async () => {
    await db.setting.deleteMany({ where: { key: SETTING.reminderTimes } });
  });

  it("lets the admin change the times, with an audit row", async () => {
    await signInAs(store.admin.mobile);
    const times = { ...DEFAULT_REMINDER_TIMES, morningSummary: "08:45" };
    expect(await updateReminderSettings(times)).toMatchObject({ ok: true });
    expect(await reminderTimes()).toEqual(times);
    expect(
      await db.auditLog.count({
        where: {
          action: AUDIT.settingUpdate,
          entityId: SETTING.reminderTimes,
          userId: store.admin.id,
        },
      }),
    ).toBe(1);
  });

  it("refuses a manager, and slots out of order", async () => {
    await signInAs(store.managerA.mobile);
    expect(await updateReminderSettings(DEFAULT_REMINDER_TIMES)).toMatchObject({
      code: "FORBIDDEN",
    });
    await signInAs(store.admin.mobile);
    expect(
      await updateReminderSettings({ ...DEFAULT_REMINDER_TIMES, slotEvening: "09:00" }),
    ).toMatchObject({ ok: false });
    expect(await reminderTimes()).toEqual(DEFAULT_REMINDER_TIMES);
  });

  it("the worker's tick follows a changed time from the next minute (Done when)", async () => {
    const at = (hhmm: string) => new Date(`${D}T${hhmm}:00.000+05:30`);
    await db.job.deleteMany({ where: { singletonKey: { contains: D } } });

    expect(await tick(at("09:30"))).toBe(1); // default time
    expect(await tick(at("09:30"))).toBe(1); // same minute again: still one job
    expect(await db.job.count({ where: { singletonKey: `reminders-morning:${D}` } })).toBe(1);

    await signInAs(store.admin.mobile);
    await updateReminderSettings({ ...DEFAULT_REMINDER_TIMES, slotEvening: "18:15" });
    expect(await tick(at("17:30"))).toBe(0); // the old time is quiet
    expect(await tick(at("18:15"))).toBe(1);
    expect(await db.job.count({ where: { singletonKey: `reminders-slot:${D}:EVENING` } })).toBe(1);
  });
});
