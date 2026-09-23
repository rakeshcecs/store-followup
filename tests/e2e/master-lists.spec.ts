import argon2 from "argon2";
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";

const PIN = "4839";
const mobile = () => `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;

test.describe("master lists", () => {
  const users: string[] = [];
  const categories: string[] = [];

  test.afterAll(async () => {
    await db.requirementCategory.deleteMany({ where: { id: { in: categories } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  test("an admin adds a category and it becomes available without a code change", async ({
    page,
  }) => {
    const branch = await db.branch.findFirstOrThrow({ where: { status: "ACTIVE" } });
    const admin = await db.user.create({
      data: {
        fullName: "E2E Lists Admin",
        mobile: mobile(),
        role: "ADMIN",
        homeBranchId: branch.id,
        pinHash: await argon2.hash(PIN),
        mustChangePin: false,
      },
    });
    users.push(admin.id);

    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(admin.mobile);
    await page.getByLabel(en.auth.fields.pin).fill(PIN);
    await page.getByRole("button", { name: en.auth.logIn }).click();
    await expect(page).toHaveURL(/\/overview/);

    await page.goto("/settings/categories");
    const name = unique("Lehenga");
    await page.getByLabel(en.masterLists.fields.nameEn).first().fill(name);
    await page.getByLabel(en.masterLists.fields.nameHi).first().fill(`${name} हिन्दी`);
    await page.getByLabel(en.masterLists.fields.nameGu).first().fill(`${name} ગુજરાતી`);
    await page.getByRole("button", { name: en.masterLists.add }).first().click();

    await expect(page.getByText(name).first()).toBeVisible();

    const saved = await db.requirementCategory.findFirstOrThrow({ where: { nameEn: name } });
    categories.push(saved.id);
    expect(saved.active).toBe(true);
    expect(saved.branchId).toBeNull(); // every branch by default (SOW M17.07)

    // Still there after a reload: the list is the database, not component state.
    await page.reload();
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test("the lists are admin-only", async ({ page }) => {
    const branch = await db.branch.findFirstOrThrow({ where: { status: "ACTIVE" } });
    const manager = await db.user.create({
      data: {
        fullName: "E2E Lists Manager",
        mobile: mobile(),
        role: "MANAGER",
        homeBranchId: branch.id,
        pinHash: await argon2.hash(PIN),
        mustChangePin: false,
      },
    });
    users.push(manager.id);

    await page.goto("/login");
    await page.getByLabel(en.auth.fields.mobile).fill(manager.mobile);
    await page.getByLabel(en.auth.fields.pin).fill(PIN);
    await page.getByRole("button", { name: en.auth.logIn }).click();

    expect((await page.goto("/settings/categories"))?.status()).toBe(404);
    expect((await page.goto("/settings/reasons"))?.status()).toBe(404);
  });
});
