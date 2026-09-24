import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { TIMELINE } from "@/lib/timeline";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M06's "Done when": the profile shows the customer and their whole history, anyone may
// open it (BR-16), and only the right people may change it (M06.07).

test.describe("customer profile and history", () => {
  const users: string[] = [];
  const customers: string[] = [];
  const branches: string[] = [];

  test.afterAll(async () => {
    await db.timelineEvent.deleteMany({ where: { customerId: { in: customers } } });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  // Two branches: the customer walked in at A, and B's salesperson finds them later.
  async function twoBranches() {
    const branchA = await db.branch.findFirstOrThrow({ where: { status: "ACTIVE" } });
    const branchB = await db.branch.create({
      data: {
        name: `E2E Profile ${randomMobile()}`,
        address: "1 Ring Road",
        city: "Surat",
        phone: "0261 123 4567",
      },
    });
    branches.push(branchB.id);
    const salesA = await makeStaff("SALESPERSON", "E2E Profile Owner", branchA.id);
    const salesB = await makeStaff("SALESPERSON", "E2E Profile Visitor", branchB.id);
    const manager = await makeStaff("MANAGER", "E2E Profile Manager", branchA.id);
    users.push(salesA.id, salesB.id, manager.id);

    const customer = await db.customer.create({
      data: {
        name: "Profile Customer",
        mobile: randomMobile(),
        area: "Satellite",
        assignedToId: salesA.id,
        homeBranchId: branchA.id,
      },
    });
    customers.push(customer.id);
    await db.timelineEvent.create({
      data: {
        customerId: customer.id,
        staffId: salesA.id,
        type: TIMELINE.customerAdded.type,
        title: TIMELINE.customerAdded.title,
        createdAt: new Date("2026-08-01T04:30:00.000Z"), // before anything else here
      },
    });
    return { salesA, salesB, manager, customer };
  }

  test("another branch's salesperson can read the profile but not change it", async ({ page }) => {
    const { salesB, customer } = await twoBranches();
    await signIn(page, salesB.mobile, "SALESPERSON");

    await page.goto(`/customers?mobile=${customer.mobile}`);
    await page.getByRole("link", { name: en.customers.openHistory }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}`));

    await expect(page.getByRole("heading", { name: "Profile Customer" })).toBeVisible();
    await expect(page.getByText(en.customers.profile.status.new)).toBeVisible();
    await expect(page.getByText(en.customers.profile.noEnquiry)).toBeVisible();
    await expect(page.getByText(en.timeline.customerAdded)).toBeVisible();

    // Call and WhatsApp open on the phone; nothing is sent by itself.
    await expect(
      page.getByRole("link", {
        name: en.customers.profile.call.replace("{name}", "Profile Customer"),
      }),
    ).toHaveAttribute("href", `tel:+91${customer.mobile}`);
    await expect(
      page.getByRole("link", {
        name: en.customers.profile.whatsapp.replace("{name}", "Profile Customer"),
      }),
    ).toHaveAttribute("href", `https://wa.me/91${customer.mobile}`);

    // Not theirs: no pencil, and the edit screen sends them back.
    await expect(page.getByRole("link", { name: en.customers.profile.edit })).toHaveCount(0);
    await page.goto(`/customers/${customer.id}/edit`);
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
  });

  test("the assigned salesperson edits the details, and the history says so", async ({ page }) => {
    const { salesA, customer } = await twoBranches();
    await signIn(page, salesA.mobile, "SALESPERSON");

    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("link", { name: en.customers.profile.edit }).click();

    // Only a manager may change the number.
    await expect(page.getByLabel(en.customers.fields.mobile)).toHaveCount(0);
    await page.getByLabel(en.customers.fields.area).fill("Maninagar");
    await page.getByRole("button", { name: en.customers.edit.save }).click();

    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
    await expect(page.getByText(/Maninagar/)).toBeVisible();
    await expect(page.getByText(en.timeline.detailsEdited)).toBeVisible();
  });

  test("a manager can change the mobile number", async ({ page }) => {
    const { manager, customer } = await twoBranches();
    await signIn(page, manager.mobile, "MANAGER");

    await page.goto(`/customers/${customer.id}/edit`);
    const mobile = randomMobile();
    await page.getByLabel(en.customers.fields.mobile).fill(mobile);
    await page.getByRole("button", { name: en.customers.edit.save }).click();

    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
    await expect
      .poll(async () => (await db.customer.findUnique({ where: { mobile } }))?.id)
      .toBe(customer.id);
  });

  test("older history comes 20 at a time", async ({ page }) => {
    const { salesA, customer } = await twoBranches();
    const start = Date.parse("2026-09-01T04:30:00.000Z");
    await db.timelineEvent.createMany({
      data: Array.from({ length: 21 }, (_, index) => ({
        customerId: customer.id,
        staffId: salesA.id,
        type: TIMELINE.visit.type,
        title: TIMELINE.visit.title,
        detail: `Visit note ${index + 1}`,
        createdAt: new Date(start + index * 60_000),
      })),
    });
    await signIn(page, salesA.mobile, "SALESPERSON");

    await page.goto(`/customers/${customer.id}`);
    // 22 rows: the newest 20 show, the first visit and "Customer added" do not.
    await expect(page.getByText("Visit note 21")).toBeVisible();
    await expect(page.getByText("Visit note 1", { exact: true })).toHaveCount(0);

    await page.getByRole("link", { name: en.customers.profile.showMore }).click();
    await expect(page.getByText("Visit note 1", { exact: true })).toBeVisible();
    await expect(page.getByText(en.timeline.customerAdded)).toBeVisible();
    await expect(page.getByRole("link", { name: en.customers.profile.showMore })).toHaveCount(0);
  });
});
