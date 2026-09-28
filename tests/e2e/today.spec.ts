import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import type { TimeSlot } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { isoDate } from "@/lib/format";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M11: the salesperson's Today screen and the Follow-ups list, for a salesperson and a
// manager. Everything lives in a branch of its own, so the manager's list holds only
// what this spec made.

const today = isoDate(new Date());
const count = (text: string, n: number) => text.replace("{count}", String(n));

test.describe("today and follow-ups", () => {
  let branchId: string;
  const users: string[] = [];
  const customers: string[] = [];
  const otherBranches: string[] = [];

  test.beforeAll(async () => {
    branchId = (
      await db.branch.create({
        data: {
          name: `E2E Today ${randomUUID().slice(0, 6)}`,
          address: "1 Relief Road",
          city: "Ahmedabad",
          phone: "079 2222 3333",
        },
      })
    ).id;
  });

  test.afterAll(async () => {
    const where = { customerId: { in: customers } };
    await db.followUp.deleteMany({ where });
    await db.enquiry.deleteMany({ where });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    // Test rows only; the app itself never hard-deletes (CLAUDE.md).
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.delete({ where: { id: branchId } });
    await db.branch.deleteMany({ where: { id: { in: otherBranches } } });
    await db.$disconnect();
  });

  async function followUp(
    owner: { id: string },
    name: string,
    due: string,
    extra: { slot?: TimeSlot; notReachableCount?: number } = {},
  ) {
    const customer = await db.customer.create({
      data: { name, mobile: randomMobile(), assignedToId: owner.id, homeBranchId: branchId },
    });
    customers.push(customer.id);
    const enquiry = await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: owner.id, title: "Lehenga" },
    });
    return db.followUp.create({
      data: {
        branchId,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${due}T00:00:00.000Z`),
        timeSlot: extra.slot ?? "EVENING",
        method: "CALL",
        reason: `Call ${name} about the lehenga`,
        assignedToId: owner.id,
        createdFrom: "VISIT",
        notReachableCount: extra.notReachableCount ?? 0,
      },
    });
  }

  async function seller(name: string) {
    const person = await makeStaff("SALESPERSON", name, branchId);
    users.push(person.id);
    return person;
  }

  test("Today shows overdue, today's and coming-up follow-ups, and Update opens one", async ({
    page,
  }) => {
    const sales = await seller("E2E Meena Shah");
    await followUp(sales, "Overdue Ritu", addDays(today, -2));
    const due = await followUp(sales, "Today Kavita", today, {
      slot: "MORNING",
      notReachableCount: 3,
    });
    await followUp(sales, "Later Pooja", addDays(today, 3));
    await signIn(page, sales.mobile, "SALESPERSON");

    // The greeting uses the first name; the hour decides the words.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E");
    await expect(page.getByRole("link", { name: en.customers.findCta })).toBeVisible();

    await expect(page.getByRole("heading", { name: count(en.today.overdue, 1) })).toBeVisible();
    await expect(page.getByText("2 days late")).toBeVisible();
    await expect(page.getByRole("heading", { name: count(en.today.dueToday, 1) })).toBeVisible();
    await expect(page.getByText(count(en.followUpResult.missedCalls, 3))).toBeVisible();
    await expect(page.getByRole("heading", { name: en.today.comingUp })).toBeVisible();
    await expect(page.getByRole("link", { name: "Later Pooja" })).toBeVisible();

    const card = page.getByTestId("follow-up-card").filter({ hasText: "Today Kavita" });
    await expect(card.getByText(en.followUps.card.today, { exact: true })).toBeVisible();
    await expect(card.getByText(`Lehenga · ${en.followUps.slotWord.MORNING}`)).toBeVisible();
    await expect(card.getByRole("link", { name: en.followUpResult.call })).toHaveAttribute(
      "href",
      /^tel:\+91\d{10}$/,
    );
    await card.getByRole("link", { name: en.followUps.card.update }).click();
    await expect(page).toHaveURL(new RegExp(`/follow-ups/${due.id}`));

    // My profile moved from the nav to the avatar.
    await page.getByRole("link", { name: en.nav.profile }).click();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test("with nothing due today, Today says all done", async ({ page }) => {
    const sales = await seller("E2E Quiet Seller");
    await signIn(page, sales.mobile, "SALESPERSON");
    await expect(page.getByText(en.today.empty)).toBeVisible();
    await expect(page.getByRole("heading", { name: count(en.today.overdue, 0) })).toHaveCount(0);
  });

  test("Follow-ups: tabs and search for a salesperson, a salesperson filter for a manager", async ({
    page,
  }) => {
    const sales = await seller("E2E List Seller");
    const other = await seller("E2E Other Seller");
    await followUp(sales, "Tab Overdue Nisha", addDays(today, -1));
    await followUp(sales, "Tab Today Hema", today);
    await followUp(other, "Other Person Lata", today);

    await signIn(page, sales.mobile, "SALESPERSON");
    await page.getByRole("link", { name: en.nav.followUps, exact: true }).click();
    await expect(page).toHaveURL(/\/follow-ups$/);
    const cards = page.getByTestId("follow-up-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Tab Today Hema");

    // Each tab carries its count, e.g. "Overdue 1".
    const tab = (label: string) =>
      page.getByRole("link", { name: new RegExp(`^${label}\\s*\\d+$`) });
    await expect(page.getByTestId("tab-count-overdue")).toHaveText("1");
    await tab(en.followUps.list.tabs.overdue).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Tab Overdue Nisha");

    await tab(en.followUps.list.tabs.all).click();
    await expect(cards).toHaveCount(2);

    // Typing alone searches — no Enter. From Pending, an overdue name finds nothing there,
    // but the Overdue count shows where it is, and "Search all" opens it.
    await tab(en.followUps.list.tabs.pending).click();
    await expect(page).toHaveURL(/\/follow-ups$/);
    await page.getByLabel(en.followUps.list.filters.search).fill("nisha");
    await expect(page).toHaveURL(/q=nisha/);
    await expect(cards).toHaveCount(0);
    await expect(page.getByTestId("tab-count-overdue")).toHaveText("1");
    await expect(page.getByTestId("tab-count-pending")).toHaveText("0");
    await page.getByRole("link", { name: en.followUps.list.searchAll }).click();
    await expect(page).toHaveURL(/tab=all/);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Tab Overdue Nisha");
    await expect(page.getByText("Other Person Lata")).toHaveCount(0);

    // A manager of the branch sees everyone's, and can narrow to one person.
    const manager = await makeStaff("MANAGER", "E2E List Manager", branchId);
    users.push(manager.id);
    await page.context().clearCookies();
    await signIn(page, manager.mobile, "MANAGER");
    await page.getByRole("link", { name: en.nav.followUps, exact: true }).first().click();
    await expect(cards).toHaveCount(2);
    await page.getByLabel(en.followUps.list.filters.assignedTo).selectOption(other.id);
    await expect(page).toHaveURL(new RegExp(`assignedTo=${other.id}`));
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Other Person Lata");
  });

  test("a manager can filter by another branch's salesperson whose follow-up was set here", async ({
    page,
  }) => {
    // Their customer walked into this branch: the follow-up is filed here (SOW: "recorded
    // against the branch where they happen") but stays with their own salesperson.
    const elsewhere = await db.branch.create({
      data: {
        name: `E2E Elsewhere ${randomUUID().slice(0, 6)}`,
        address: "2 Ring Road",
        city: "Surat",
        phone: "0261 111 2222",
      },
    });
    otherBranches.push(elsewhere.id);
    const visitor = await makeStaff("SALESPERSON", "E2E Visiting Seller", elsewhere.id);
    users.push(visitor.id);
    await followUp(visitor, "Walked In Farida", today);

    const manager = await makeStaff("MANAGER", "E2E Filter Manager", branchId);
    users.push(manager.id);
    await signIn(page, manager.mobile, "MANAGER");
    await page.goto("/follow-ups");

    await page.getByLabel(en.followUps.list.filters.assignedTo).selectOption(visitor.id);
    const cards = page.getByTestId("follow-up-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Walked In Farida");
  });

  test("a finished follow-up's whole card opens the profile; a pending one keeps its buttons", async ({
    page,
  }) => {
    const sales = await seller("E2E Card Seller");
    const done = await followUp(sales, "Done Card Rekha", today);
    await db.followUp.update({
      where: { id: done.id },
      data: { status: "DONE", result: "CALL_LATER", completedAt: new Date() },
    });
    await followUp(sales, "Pending Card Sonal", today);
    await signIn(page, sales.mobile, "SALESPERSON");
    await page.goto("/follow-ups?tab=all");

    // Pending: the card itself is not a link, so its buttons stay the only targets.
    const pending = page.getByTestId("follow-up-card").filter({ hasText: "Pending Card Sonal" });
    await expect(pending).not.toHaveAttribute("href");
    await expect(pending.getByRole("link", { name: en.followUps.card.update })).toBeVisible();

    // Done: nothing else to tap, so a tap anywhere — here the result line — opens it.
    const finished = page.getByTestId("follow-up-card").filter({ hasText: "Done Card Rekha" });
    await expect(finished).toHaveAttribute("href", `/customers/${done.customerId}`);
    await finished.getByText(en.followUpResult.option.CALL_LATER.label).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${done.customerId}`));
  });
});
