import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";
import { SETTING } from "@/lib/settings";
import { makeStaff, signIn } from "./helpers";

// M14: the bell, its list, and Settings → Reminders. Pushes to a real phone can't be
// driven from here; the worker's side is covered in tests/db/reminders.test.ts.

test.describe("notifications", () => {
  const users: string[] = [];

  test.afterAll(async () => {
    // Test rows only; the app itself never hard-deletes (CLAUDE.md).
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  test("the bell counts what is new; opening the list shows it and clears the count", async ({
    page,
  }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Bell Seller");
    users.push(sales.id);
    const today = isoDate(new Date());
    await db.notification.createMany({
      data: [
        {
          id: randomUUID(),
          userId: sales.id,
          type: "summary-morning",
          message: `summary-morning:${today}:5:2`,
          link: "/today",
          pushedAt: new Date(),
        },
        {
          id: randomUUID(),
          userId: sales.id,
          type: "summary-morning",
          message: `summary-morning:2020-01-01:1:0`, // older than 30 days: not in the list
          link: "/today",
          sentAt: new Date("2020-01-01T04:00:00Z"),
          pushedAt: new Date(),
        },
      ],
    });

    await signIn(page, sales.mobile, "SALESPERSON");
    const bell = page.getByRole("link", { name: "1 new notification" });
    await expect(bell).toBeVisible();
    await expect(page.getByTestId("bell-count")).toHaveText("1");

    await bell.click();
    await expect(page).toHaveURL(/\/notifications$/);
    const rows = page.getByTestId("notification-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(en.notifications.morning.title);
    await expect(rows.first()).toContainText(
      "Good morning! You have 5 follow-ups today and 2 overdue.",
    );
    // Marked read: the count leaves the bell.
    await expect(page.getByTestId("bell-count")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "No new notifications" })).toBeVisible();

    // Tapping it opens the matching screen (M14.05).
    await rows.first().click();
    await expect(page).toHaveURL(/\/today$/);
  });

  test("an empty list says so", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Quiet Bell");
    users.push(sales.id);
    await signIn(page, sales.mobile, "SALESPERSON");
    await page.goto("/notifications");
    await expect(page.getByText(en.notifications.empty)).toBeVisible();
  });

  test("the admin sets the reminder times; a salesperson cannot open that screen", async ({
    page,
  }, testInfo) => {
    // A store-wide setting: one project changes it, so two runs never race on it.
    test.skip(testInfo.project.name !== "desktop", "store-wide setting, desktop only");
    // Put the store's times back afterwards, here and not in afterAll: every parallel
    // worker runs afterAll, and one of them would undo this test while it is running.
    const before = (await db.setting.findUnique({ where: { key: SETTING.reminderTimes } }))?.value;
    const admin = await makeStaff("ADMIN", "E2E Reminder Admin");
    const sales = await makeStaff("SALESPERSON", "E2E Reminder Seller");
    users.push(admin.id, sales.id);

    await signIn(page, admin.mobile, "ADMIN");
    await page.goto("/settings");
    await page.getByRole("link", { name: new RegExp(en.settings.reminders) }).click();
    await expect(page).toHaveURL(/\/settings\/reminders$/);

    // Out of order is refused next to the field.
    await page.getByLabel(en.reminderSettings.slotEvening).fill("09:00");
    await page.getByRole("button", { name: en.reminderSettings.save }).click();
    await expect(page.getByText(en.reminderSettings.errors.slotOrder)).toBeVisible();

    await page.getByLabel(en.reminderSettings.slotEvening).fill("18:15");
    await page.getByRole("button", { name: en.reminderSettings.save }).click();
    await expect(page.getByText(en.reminderSettings.saved)).toBeVisible();
    const saved = await db.setting.findUniqueOrThrow({ where: { key: SETTING.reminderTimes } });
    expect(saved.value).toMatchObject({ slotEvening: "18:15" });

    if (before === undefined) {
      await db.setting.delete({ where: { key: SETTING.reminderTimes } });
    } else {
      await db.setting.update({
        where: { key: SETTING.reminderTimes },
        data: { value: before as object, updatedById: null },
      });
    }

    await page.context().clearCookies();
    await signIn(page, sales.mobile, "SALESPERSON");
    expect((await page.goto("/settings/reminders"))?.status()).toBe(404);
  });
});
