import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M15: a manager hands one customer to a colleague from the profile, and an admin moves a
// leaving salesperson's whole book and makes them inactive in one step (M15.02).

test.describe("reassignment", () => {
  const users: string[] = [];
  const customers: string[] = [];
  const branches: string[] = [];

  test.afterAll(async () => {
    // Test rows only; the app itself never hard-deletes (CLAUDE.md).
    await db.timelineEvent.deleteMany({ where: { customerId: { in: customers } } });
    await db.followUp.deleteMany({ where: { customerId: { in: customers } } });
    await db.enquiry.deleteMany({ where: { customerId: { in: customers } } });
    await db.customer.deleteMany({ where: { id: { in: customers } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.$disconnect();
  });

  // A branch of its own, so the lists hold only this test's people.
  async function shop() {
    const branch = await db.branch.create({
      data: {
        name: `E2E Reassign ${randomUUID().slice(0, 6)}`,
        address: "1 Test Road",
        city: "Surat",
        phone: "9825012345",
      },
    });
    branches.push(branch.id);
    return branch.id;
  }

  async function customerOf(ownerId: string, branchId: string, name: string) {
    const customer = await db.customer.create({
      data: { name, mobile: randomMobile(), assignedToId: ownerId, homeBranchId: branchId },
    });
    customers.push(customer.id);
    const enquiry = await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: ownerId, title: "Wedding" },
    });
    await db.followUp.create({
      data: {
        branchId,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: calendarDay(isoDate(new Date(Date.now() + 2 * 86_400_000))),
        timeSlot: "EVENING",
        method: "CALL",
        assignedToId: ownerId,
        createdFrom: "VISIT",
      },
    });
    return customer;
  }

  test("a manager gives one customer to a colleague from the profile", async ({ page }) => {
    const branchId = await shop();
    const manager = await makeStaff("MANAGER", "E2E Reassign Manager", branchId);
    const amit = await makeStaff("SALESPERSON", "E2E Amit", branchId);
    const priya = await makeStaff("SALESPERSON", "E2E Priya", branchId);
    users.push(manager.id, amit.id, priya.id);
    const customer = await customerOf(amit.id, branchId, "E2E Rajesh Reassign");
    await customerOf(amit.id, branchId, "E2E Other Of Amit");

    await signIn(page, manager.mobile, "MANAGER");
    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("link", { name: en.customers.profile.changeSalesperson }).click();

    await expect(page).toHaveURL(/\/staff\/reassign\?from=/);
    // Only this customer is ticked; Amit's other one is listed but not.
    await expect(page.getByRole("checkbox", { name: /E2E Rajesh Reassign/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /E2E Other Of Amit/ })).not.toBeChecked();
    await page.getByLabel(en.reassign.to, { exact: true }).selectOption({ label: "E2E Priya" });
    await page.getByRole("button", { name: "Reassign 1 customer" }).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "Move 1 customer and 1 pending follow-up from E2E Amit to E2E Priya?",
    );
    await page.getByRole("button", { name: en.reassign.confirm }).click();

    // Back on the profile: Priya's now, and the history says who moved it.
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
    await expect(page.getByText("Reassigned from E2E Amit to E2E Priya")).toBeVisible();
    await expect(page.getByText("E2E Reassign Manager").first()).toBeVisible();
    expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).assignedToId).toBe(
      priya.id,
    );
  });

  test("an admin moves a leaver's customers and makes them inactive", async ({ page }) => {
    const branchId = await shop();
    const admin = await makeStaff("ADMIN", "E2E Reassign Admin", branchId);
    const leaver = await makeStaff("SALESPERSON", "E2E Leaver", branchId);
    const heir = await makeStaff("SALESPERSON", "E2E Heir", branchId);
    users.push(admin.id, leaver.id, heir.id);
    await customerOf(leaver.id, branchId, "E2E Leaver Customer One");
    await customerOf(leaver.id, branchId, "E2E Leaver Customer Two");

    await signIn(page, admin.mobile, "ADMIN");
    await page.goto("/staff?q=E2E%20Leaver");
    await page.getByRole("link", { name: en.staff.reassignAndDeactivate }).click();
    await expect(page).toHaveURL(/\/staff\/reassign\?from=.*&exit=1/);

    await expect(page.getByTestId("reassign-row")).toHaveCount(2);
    await page.getByLabel(en.reassign.to, { exact: true }).selectOption({ label: "E2E Heir" });
    await page.getByRole("button", { name: "Reassign all and make E2E Leaver inactive" }).click();
    await page.getByRole("button", { name: en.reassign.confirm }).click();

    await expect(page).toHaveURL(/\/staff$/);
    const gone = await db.user.findUniqueOrThrow({ where: { id: leaver.id } });
    expect(gone.status).toBe("INACTIVE");
    // Done when: no PENDING follow-up is left on an inactive person.
    expect(await db.followUp.count({ where: { assignedToId: leaver.id, status: "PENDING" } })).toBe(
      0,
    );
    expect(await db.customer.count({ where: { assignedToId: heir.id } })).toBe(2);
  });

  test("a salesperson cannot open the screen", async ({ page }) => {
    const sales = await makeStaff("SALESPERSON", "E2E Reassign Seller");
    users.push(sales.id);
    await signIn(page, sales.mobile, "SALESPERSON");
    expect((await page.goto("/staff/reassign"))?.status()).toBe(404);
  });
});
