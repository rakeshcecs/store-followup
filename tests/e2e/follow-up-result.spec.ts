import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { dayForDisplay, followUpShortcut } from "@/lib/follow-up-dates";
import { formatDayDate, isoDate } from "@/lib/format";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M09: the salesperson records what happened on a follow-up, from the profile's pending
// follow-up (until the Today screen of M11 links here).

const r = en.followUpResult;
const words = (day: string) => formatDayDate(dayForDisplay(day), "en");

test.describe("update follow-up", () => {
  const users: string[] = [];
  const customers: string[] = [];

  test.afterAll(async () => {
    const where = { customerId: { in: customers } };
    await db.timelineEvent.deleteMany({ where });
    await db.sale.deleteMany({ where });
    await db.followUp.deleteMany({ where });
    await db.enquiry.deleteMany({ where });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  // A customer with an open enquiry and a follow-up due today, assigned to `owner`.
  async function dueToday(owner: { id: string; homeBranchId: string }, name: string) {
    const customer = await db.customer.create({
      data: {
        name,
        mobile: randomMobile(),
        assignedToId: owner.id,
        homeBranchId: owner.homeBranchId,
      },
    });
    customers.push(customer.id);
    const enquiry = await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: owner.id, title: "Sherwani" },
    });
    const followUp = await db.followUp.create({
      data: {
        branchId: owner.homeBranchId,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${isoDate(new Date())}T00:00:00.000Z`),
        timeSlot: "EVENING",
        method: "CALL",
        reason: "Ask about the wedding date",
        assignedToId: owner.id,
        createdFrom: "VISIT",
      },
    });
    return { customer, followUp };
  }

  test("asked to call later: the next call is set and shown on the profile", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Result Seller");
    users.push(sales.id);
    const { customer, followUp } = await dueToday(sales, "Kiran Joshi");
    await signIn(page, sales.mobile, "SALESPERSON");
    const today = isoDate(new Date());

    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("link", { name: en.customers.profile.updateFollowUp }).click();
    await expect(page).toHaveURL(new RegExp(`/follow-ups/${followUp.id}`));
    await expect(page.getByText(r.dueToday.replace("{slot}", "evening"))).toBeVisible();
    await expect(page.getByText("Ask about the wedding date")).toBeVisible();
    await expect(page.getByRole("button", { name: r.choose })).toBeDisabled();

    await page.getByRole("radio", { name: new RegExp(r.option.CALL_LATER.label) }).click();
    await page.getByRole("radio", { name: r.shortcut.IN_3_DAYS }).click();
    await page.getByLabel(r.note).fill("Busy at work this week");
    await page.getByRole("button", { name: r.save }).click();

    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByText(r.saved)).toBeVisible();

    const next = followUpShortcut("IN_3_DAYS", today);
    const done = await db.followUp.findUniqueOrThrow({ where: { id: followUp.id } });
    expect(done.status).toBe("DONE");
    expect(done.result).toBe("CALL_LATER");
    const pending = await db.followUp.findFirstOrThrow({
      where: { customerId: customer.id, status: "PENDING" },
    });
    expect(isoDate(pending.dueDate)).toBe(next);

    await page.goto(`/customers/${customer.id}`);
    await expect(
      page.getByText(
        en.customers.profile.followUpDue
          .replace("{date}", words(next))
          .replace("{slot}", "evening"),
      ),
    ).toBeVisible();
    await expect(
      page.getByText(en.timeline.followUpCall.CALL_LATER.replace("{date}", words(next))),
    ).toBeVisible();
  });

  test("customer already bought: the sale completes the follow-up", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Bought Seller");
    users.push(sales.id);
    const { customer, followUp } = await dueToday(sales, "Meera Iyer");
    await signIn(page, sales.mobile, "SALESPERSON");

    await page.goto(`/follow-ups/${followUp.id}`);
    await page.getByRole("radio", { name: new RegExp(r.option.ALREADY_BOUGHT.label) }).click();
    await page.getByLabel(r.note).fill("Bought on Sunday");
    await page.getByRole("button", { name: r.nextBill }).click();
    await expect(page).toHaveURL(/\/sales\/new\?/);

    const bill = `E2E-FU-${randomMobile().slice(-5)}`;
    await page.getByLabel(en.sales.billNumber).fill(bill);
    await expect(page.getByText(en.sales.billFree)).toBeVisible();
    // "Amount (₹)" or "Amount (optional)": another spec may flip the setting.
    await page.getByLabel(/^Amount/).fill("7200");
    await page.getByRole("button", { name: en.sales.save }).click();
    await expect(page).toHaveURL(/\/today/);

    const done = await db.followUp.findUniqueOrThrow({ where: { id: followUp.id } });
    expect(done.status).toBe("DONE");
    expect(done.result).toBe("ALREADY_BOUGHT");
    expect(done.resultNote).toBe("Bought on Sunday");
    const sale = await db.sale.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(sale.linkedFollowUpId).toBe(followUp.id);
    expect(sale.fromFollowUp).toBe(true);
  });

  test("another salesperson cannot open someone else's follow-up", async ({ page }) => {
    const owner = await makeStaff("SALESPERSON", "E2E Owner Seller");
    const other = await makeStaff("SALESPERSON", "E2E Other Seller");
    users.push(owner.id, other.id);
    const { customer, followUp } = await dueToday(owner, "Farah Khan");
    await signIn(page, other.mobile, "SALESPERSON");

    expect((await page.goto(`/follow-ups/${followUp.id}`))?.status()).toBe(404);
    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByRole("link", { name: en.customers.profile.updateFollowUp })).toHaveCount(
      0,
    );
  });
});
