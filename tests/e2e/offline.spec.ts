import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M19 "Done when", in a production build with the real service worker:
// - with the network off, a salesperson adds a customer, their visit and a follow-up;
//   turning it back on syncs them, with no duplicates;
// - a bill number used by someone else meanwhile is caught at sync and fixed on the
//   "Needs your attention" list.
// Plus: the offline copy is encrypted per session and wiped at the login screen, and a
// manager of the branch sees what was synced while the other branch's manager does not.

test.describe("offline entry and sync", () => {
  // Every offline step is a full page load from the service worker, and a sync waits for
  // the network to come back.
  test.setTimeout(120_000);
  const users: string[] = [];
  const branches: string[] = [];
  const categories: string[] = [];
  const tag = randomMobile().slice(-5);
  const categoryName = `E2E Offline Kurta ${tag}`;

  test.beforeAll(async () => {
    categories.push(
      (
        await db.requirementCategory.create({
          data: { nameEn: categoryName, nameHi: `कुर्ता ${tag}`, nameGu: `કુર્તા ${tag}` },
        })
      ).id,
    );
  });

  test.afterAll(async () => {
    const customers = (
      await db.customer.findMany({
        where: { homeBranchId: { in: branches } },
        select: { id: true },
      })
    ).map((row) => row.id);
    const where = { customerId: { in: customers } };
    await db.timelineEvent.deleteMany({ where });
    await db.sale.deleteMany({ where });
    await db.followUp.deleteMany({ where });
    await db.visit.deleteMany({ where });
    await db.enquiry.deleteMany({ where });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.requirementCategory.deleteMany({ where: { id: { in: categories } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  async function shop() {
    const branch = await db.branch.create({
      data: {
        name: `E2E Offline ${randomUUID().slice(0, 6)}`,
        address: "1 Test Road",
        city: "Surat",
        phone: "9825012345",
      },
    });
    branches.push(branch.id);
    return branch.id;
  }

  // Signed in, the service worker in control (so offline pages come from it) and the
  // offline copy saved.
  async function readyForOffline(page: Page, mobile: string) {
    const copied = page.waitForResponse(
      (response) => response.url().endsWith("/api/sync/cache") && response.ok(),
    );
    await signIn(page, mobile, "SALESPERSON");
    await copied;
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
      timeout: 30_000,
    });
    // The copy is written after the response arrives.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const names = (await indexedDB.databases()).map((database) => database.name);
          return names.includes("store-followup-offline");
        }),
      )
      .toBe(true);
    await page.waitForTimeout(500);
  }

  async function goOffline(context: BrowserContext) {
    await context.setOffline(true);
  }

  test("offline customer, visit and follow-up sync with no duplicates", async ({
    page,
    context,
    browser,
  }) => {
    const branchA = await shop();
    const branchB = await shop();
    const sales = await makeStaff("SALESPERSON", "E2E Offline Seller", branchA);
    const managerA = await makeStaff("MANAGER", "E2E Offline Manager A", branchA);
    const managerB = await makeStaff("MANAGER", "E2E Offline Manager B", branchB);
    users.push(sales.id, managerA.id, managerB.id);
    const mobile = randomMobile();

    await readyForOffline(page, sales.mobile);
    await goOffline(context);

    // Find customer → not on this phone → add them.
    await page.goto(`/customers?mobile=${mobile}`);
    await expect(page.getByTestId("offline-copy")).toBeVisible();
    await expect(page.getByTestId("sync-status")).toContainText(en.sync.status.offline);
    await page.getByRole("link", { name: en.customers.create }).click();
    await expect(page).toHaveURL(/\/customers\/new/);
    await page.getByLabel(en.customers.fields.name).fill("E2E Offline Asha");
    await page.getByRole("button", { name: en.customers.save }).click();
    await expect(page.getByText(en.sync.savedOnPhone).first()).toBeVisible();

    // Straight into Record visit for the customer the phone just made.
    await expect(page).toHaveURL(/\/visits\/new\?customerId=[0-9a-f-]{36}/);
    await page.getByRole("button", { name: categoryName }).click();
    await page.getByLabel(en.visits.remarks).fill("Wants a kurta for Diwali");
    await page
      .getByRole("radio", { name: new RegExp(en.visits.outcome.DECIDE_LATER.label) })
      .click();
    await page.getByRole("button", { name: en.visits.nextFollowUp }).click();
    await expect(page).toHaveURL(/\/follow-ups\/new/);
    await page.getByRole("radio", { name: en.followUps.shortcut.TOMORROW }).click();
    await page.getByRole("button", { name: en.followUps.save }).click();
    await expect(page.getByText(en.sync.savedOnPhone).first()).toBeVisible();

    // Today, from the phone: the new follow-up is there; two entries wait.
    await expect(page.getByRole("heading", { name: en.today.comingUp })).toBeVisible();
    await expect(page.getByText("E2E Offline Asha").first()).toBeVisible();
    await expect(page.getByTestId("sync-status")).toContainText("Offline – 2 entries waiting");
    expect(await db.customer.count({ where: { mobile } })).toBe(0);

    // Search finds them on the phone now.
    await page.goto(`/customers?mobile=${mobile}`);
    await expect(page.getByTestId("offline-customer-card")).toContainText("E2E Offline Asha");
    await expect(page.getByTestId("offline-customer-card")).toContainText(
      en.offlineApp.addedOffline,
    );

    // Back online: synced, green for a moment, and in the database once.
    await context.setOffline(false);
    await expect(page.getByTestId("sync-status")).toContainText(en.sync.status.synced, {
      timeout: 20_000,
    });
    const customer = await db.customer.findUniqueOrThrow({ where: { mobile } });
    expect(customer).toMatchObject({
      enteredOffline: true,
      homeBranchId: branchA,
      assignedToId: sales.id,
      createdById: sales.id,
    });
    const visit = await db.visit.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(visit).toMatchObject({
      enteredOffline: true,
      branchId: branchA,
      outcome: "DECIDE_LATER",
    });
    expect(visit.remarks).toBe("Wants a kurta for Diwali");
    const followUp = await db.followUp.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(followUp).toMatchObject({ enteredOffline: true, status: "PENDING", method: "CALL" });

    // A second sync (reload = app open) sends nothing new.
    await page.goto("/today");
    await page.waitForLoadState("networkidle");
    expect(await db.customer.count({ where: { mobile } })).toBe(1);
    expect(await db.visit.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await db.followUp.count({ where: { customerId: customer.id } })).toBe(1);
    await expect(page.getByTestId("sync-status")).toHaveCount(0);

    // The online profile shows it, like any other customer.
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByText("Wants a kurta for Diwali").first()).toBeVisible();

    // Manager A sees the follow-up in their branch; manager B does not.
    for (const [manager, visible] of [
      [managerA, true],
      [managerB, false],
    ] as const) {
      const other = await browser.newContext();
      const managerPage = await other.newPage();
      await signIn(managerPage, manager.mobile, "MANAGER");
      await managerPage.goto(`/follow-ups?tab=pending&q=${mobile}`);
      if (visible) {
        await expect(managerPage.getByText("E2E Offline Asha").first()).toBeVisible();
      } else {
        await expect(managerPage.getByText("E2E Offline Asha")).toHaveCount(0);
        expect((await managerPage.request.get(`/follow-ups/${followUp.id}`)).status()).toBe(404);
      }
      await other.close();
    }
  });

  test("a bill number used meanwhile is caught at sync and fixed from the list", async ({
    page,
    context,
  }) => {
    const branchA = await shop();
    const sales = await makeStaff("SALESPERSON", "E2E Offline Biller", branchA);
    const other = await makeStaff("SALESPERSON", "E2E Other Biller", branchA);
    users.push(sales.id, other.id);
    const customer = await db.customer.create({
      data: {
        name: "E2E Bill Customer",
        mobile: randomMobile(),
        assignedToId: sales.id,
        homeBranchId: branchA,
        createdById: sales.id,
      },
    });
    await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: sales.id, title: "Kurta" },
    });
    const bill = `E2E-${tag}`;

    await readyForOffline(page, sales.mobile);
    await goOffline(context);
    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("link", { name: en.customers.profile.saleDone }).click();
    await expect(page).toHaveURL(/\/sales\/new/);
    await page.getByLabel(en.sales.billNumber).fill(bill);
    await page.getByLabel(en.sales.amount).fill("4500");
    await page.getByRole("button", { name: en.sales.save }).click();
    await expect(page.getByText(en.sync.savedOnPhone).first()).toBeVisible();

    // Meanwhile, at the counter, someone else saved that number.
    const otherCustomer = await db.customer.create({
      data: {
        name: "E2E Counter",
        mobile: randomMobile(),
        assignedToId: other.id,
        homeBranchId: branchA,
      },
    });
    const otherEnquiry = await db.enquiry.create({
      data: { customerId: otherCustomer.id, assignedToId: other.id, title: "Kurta" },
    });
    await db.sale.create({
      data: {
        branchId: branchA,
        customerId: otherCustomer.id,
        enquiryId: otherEnquiry.id,
        clientId: randomUUID(),
        billNumber: bill,
        billDate: new Date(),
        salespersonId: other.id,
      },
    });

    await context.setOffline(false);
    await expect(page.getByTestId("sync-status")).toContainText("1 entry needs your attention", {
      timeout: 20_000,
    });
    expect(await db.sale.count({ where: { customerId: customer.id } })).toBe(0);

    await page.getByTestId("sync-status").getByRole("link").click();
    await expect(page).toHaveURL(/\/sync$/);
    const card = page.getByTestId("attention-entry");
    await expect(card).toContainText(`Sale ${bill}: E2E Bill Customer`);
    await expect(card.getByRole("alert")).toContainText("E2E Counter");
    await card.getByRole("button", { name: en.sync.center.changeBill }).click();
    await card.getByLabel(en.sync.center.newBill).fill(`${bill}-a`);
    await card.getByRole("button", { name: en.sync.center.send }).click();

    await expect(page.getByText(en.sync.center.empty)).toBeVisible({ timeout: 20_000 });
    const sale = await db.sale.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(sale).toMatchObject({
      billNumber: `${bill}-A`,
      enteredOffline: true,
      salespersonId: sales.id,
    });
    expect(Number(sale.billAmount)).toBe(4500);
  });

  test("log out warns about unsynced entries, and the login screen leaves nothing on the phone", async ({
    page,
    context,
  }) => {
    const branchA = await shop();
    const sales = await makeStaff("SALESPERSON", "E2E Offline Leaver", branchA);
    users.push(sales.id);
    const owner = await makeStaff("SALESPERSON", "E2E Other Owner", branchA);
    users.push(owner.id);
    // Someone else's customer: not on this phone, so the phone takes the number, and the
    // server says no at sync — the entry stays, needing attention.
    const taken = await db.customer.create({
      data: {
        name: "E2E Taken Number",
        mobile: randomMobile(),
        assignedToId: owner.id,
        homeBranchId: branchA,
      },
    });

    await readyForOffline(page, sales.mobile);
    // Hindi, set after login (login keeps the language chosen on the login screen). The
    // next screen sees the copy is in the wrong language and fetches it again.
    await db.user.update({ where: { id: sales.id }, data: { language: "hi" } });
    const again = page.waitForResponse(
      (response) => response.url().endsWith("/api/sync/cache") && response.ok(),
    );
    await page.goto("/today");
    await again;
    await page.waitForTimeout(500);
    await goOffline(context);

    // The offline screens speak the person's language.
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: hi.customers.title })).toBeVisible();
    await page.getByLabel(hi.customers.fields.mobile).fill(taken.mobile!);
    await page.getByRole("button", { name: hi.customers.search }).click();
    await page.getByRole("link", { name: hi.customers.create }).click();
    await page.getByLabel(hi.customers.fields.name).fill("E2E Unsynced");
    await page.getByRole("button", { name: hi.customers.save }).click();
    await expect(page).toHaveURL(/\/visits\/new/);
    await expect(page.getByText(hi.sync.savedOnPhone).first()).toBeVisible();

    // The stored copy carries no readable name.
    const stored = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const open = indexedDB.open("store-followup-offline");
          open.onsuccess = () => {
            const tx = open.result.transaction("outbox", "readonly");
            const all = tx.objectStore("outbox").getAll();
            all.onsuccess = () =>
              resolve(
                JSON.stringify(all.result, (_key, value) =>
                  value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value,
                ),
              );
          };
        }),
    );
    expect(stored).not.toContain("E2E Unsynced");
    expect(stored.length).toBeGreaterThan(50);

    // Back online: the server says the number is taken; the entry stays on the phone.
    await context.setOffline(false);
    await expect(page.getByTestId("sync-status")).toContainText("1 एंट्री पर ध्यान दें", {
      timeout: 20_000,
    });
    await page.goto("/sync");
    await expect(page.getByTestId("attention-entry").getByRole("alert")).toContainText(
      "E2E Taken Number",
    );
    await expect(page.getByRole("button", { name: hi.sync.center.useExisting })).toBeVisible();
    await page.goto("/profile");
    await page.getByRole("main").getByRole("button", { name: hi.auth.logOut }).click();
    await expect(page.getByRole("alertdialog")).toContainText("1 एंट्री");
    await page.getByRole("alertdialog").getByRole("button", { name: hi.sync.center.keep }).click();
    await expect(page).toHaveURL(/\/profile/);
    await page.getByRole("main").getByRole("button", { name: hi.auth.logOut }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: hi.auth.logOut }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await indexedDB.databases()).some(
            (database) => database.name === "store-followup-offline",
          ),
        ),
      )
      .toBe(false);
    expect(await db.customer.count({ where: { name: "E2E Unsynced" } })).toBe(0);
  });
});
