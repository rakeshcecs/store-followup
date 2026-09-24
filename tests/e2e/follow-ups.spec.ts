import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { dayForDisplay, followUpShortcut } from "@/lib/follow-up-dates";
import { formatDayDate, isoDate } from "@/lib/format";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M08: "No, will decide later" goes on to Set follow-up and saves both together; the
// profile's "Follow-up" replaces the pending one. A customer never has two pending.

const f = en.followUps;
const v = en.visits;
const words = (day: string) => formatDayDate(dayForDisplay(day), "en");

test.describe("follow-ups", () => {
  const users: string[] = [];
  const customers: string[] = [];
  const categories: string[] = [];
  const tag = randomMobile().slice(-6);
  const categoryName = `E2E Kurta ${tag}`;

  test.beforeAll(async () => {
    categories.push(
      (
        await db.requirementCategory.create({
          data: { nameEn: categoryName, nameHi: categoryName, nameGu: categoryName },
        })
      ).id,
    );
  });

  test.afterAll(async () => {
    const where = { customerId: { in: customers } };
    await db.timelineEvent.deleteMany({ where });
    await db.followUp.deleteMany({ where });
    await db.visit.deleteMany({ where });
    await db.enquiry.deleteMany({ where });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.requirementCategory.deleteMany({ where: { id: { in: categories } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  async function customerOf(owner: { id: string; homeBranchId: string }, name: string) {
    const customer = await db.customer.create({
      data: {
        name,
        mobile: randomMobile(),
        assignedToId: owner.id,
        homeBranchId: owner.homeBranchId,
      },
    });
    customers.push(customer.id);
    return customer;
  }

  test("a decide-later visit is saved with its follow-up, then shown on the profile", async ({
    page,
  }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Follow Seller");
    users.push(sales.id);
    const customer = await customerOf(sales, "Ravi Mehta");
    await signIn(page, sales.mobile, "SALESPERSON");
    const today = isoDate(new Date());

    await page.goto(`/visits/new?customerId=${customer.id}`);
    await page.getByRole("button", { name: categoryName }).click();
    await page.getByLabel(v.remarks).fill("Will come with family");
    await page.getByRole("radio", { name: new RegExp(v.outcome.DECIDE_LATER.label) }).click();
    await page.getByRole("button", { name: v.nextFollowUp }).click();
    await expect(page).toHaveURL(/\/follow-ups\/new\?/);

    // Defaults, in words, and the visit's remarks carried across (M08.04).
    const saturday = followUpShortcut("SATURDAY", today);
    await expect(
      page.getByText(f.on.replace("{date}", words(saturday)).replace("{slot}", "evening")),
    ).toBeVisible();
    await expect(page.getByLabel(f.reason)).toHaveValue("Will come with family");

    await page.getByRole("radio", { name: f.shortcut.TOMORROW }).click();
    await page.getByRole("radio", { name: f.slot.MORNING }).click();
    await page.getByRole("button", { name: f.save }).click();

    const tomorrow = followUpShortcut("TOMORROW", today);
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByText(f.saved.replace("{date}", words(tomorrow)))).toBeVisible();

    const visit = await db.visit.findFirstOrThrow({ where: { customerId: customer.id } });
    const followUp = await db.followUp.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(visit.outcome).toBe("DECIDE_LATER");
    expect(followUp.enquiryId).toBe(visit.enquiryId);
    expect(isoDate(followUp.dueDate)).toBe(tomorrow);
    expect(followUp.timeSlot).toBe("MORNING");

    await page.goto(`/customers/${customer.id}`);
    await expect(
      page.getByText(
        en.timeline.followUpSetFor.replace("{date}", words(tomorrow)).replace("{slot}", "morning"),
      ),
    ).toBeVisible();
  });

  test("the profile's Follow-up replaces the pending one", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Replace Seller");
    users.push(sales.id);
    const customer = await customerOf(sales, "Nita Shah");
    const enquiry = await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: sales.id, title: "Kurta" },
    });
    const today = isoDate(new Date());
    const old = await db.followUp.create({
      data: {
        branchId: sales.homeBranchId,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${today}T00:00:00.000Z`),
        timeSlot: "EVENING",
        method: "CALL",
        assignedToId: sales.id,
        createdFrom: "VISIT",
      },
    });
    await signIn(page, sales.mobile, "SALESPERSON");

    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("link", { name: en.customers.profile.followUp, exact: true }).click();
    await expect(page).toHaveURL(/\/follow-ups\/new\?/);
    await expect(page.getByText(f.replaces.replace("{date}", words(today)))).toBeVisible();

    await page.getByRole("radio", { name: f.shortcut.TEN_DAYS }).click();
    await page.getByRole("button", { name: f.save }).click();
    await expect(page).toHaveURL(/\/today/);

    expect((await db.followUp.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "RESCHEDULED",
    );
    const pending = await db.followUp.findMany({
      where: { customerId: customer.id, status: "PENDING" },
    });
    expect(pending).toHaveLength(1);
    expect(isoDate(pending[0]!.dueDate)).toBe(followUpShortcut("TEN_DAYS", today));
    expect(pending[0]!.createdFrom).toBe("PROFILE");
  });
});
