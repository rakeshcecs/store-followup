import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, signIn } from "./helpers";

// M23 in the browser: the admin keeps the festival calendar and the occasion lead days;
// a salesperson gets nothing. (The occasion follow-ups themselves are the worker's 6 AM
// job, covered in tests/db/festivals.test.ts.)

test.describe("festivals and occasions", () => {
  const tag = randomUUID().slice(0, 6);
  const users: string[] = [];

  test.afterAll(async () => {
    // Also whatever the pre-fill button added under this spec's admin.
    await db.festival.deleteMany({
      where: { OR: [{ name: { contains: tag } }, { createdById: { in: users } }] },
    });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  test("the admin keeps the festival calendar and the occasion setting", async ({ page }) => {
    test.slow(); // five saves in a row, then the pre-fill of two years of festivals
    const admin = await makeStaff("ADMIN", "E2E Festival Admin");
    users.push(admin.id);
    await signIn(page, admin.mobile, "ADMIN");
    await page.goto("/settings");
    await page.getByRole("link", { name: new RegExp(en.settings.festivals) }).click();
    await expect(page).toHaveURL(/\/settings\/festivals$/);
    expect(await page.evaluate(() => window.innerWidth <= screen.width)).toBe(true);

    const f = en.festivals;
    // The setting saves (the default again, so parallel specs see no change).
    await page.getByLabel(f.leadDays).fill("30");
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
    // a toast keeps it open — move away, then let it go, as a person would.
    await page.mouse.move(1, 1);
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

  test("a salesperson has no festival settings", async ({ page }) => {
    const seller = await makeStaff("SALESPERSON", "E2E Festival Outsider");
    users.push(seller.id);
    await signIn(page, seller.mobile, "SALESPERSON");
    expect((await page.request.get("/settings/festivals")).status()).not.toBe(200);
  });
});
