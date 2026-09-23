import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, signIn } from "./helpers";

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
    const admin = await makeStaff("ADMIN", "E2E Lists Admin");
    users.push(admin.id);
    await signIn(page, admin.mobile, "ADMIN");

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

  test("the drag handles hydrate, instead of being renumbered in the browser", async ({ page }) => {
    const admin = await makeStaff("ADMIN", "E2E Hydration Admin");
    users.push(admin.id);
    await signIn(page, admin.mobile, "ADMIN");
    await page.goto("/settings/categories");

    // dnd-kit numbers its own aria-describedby from a module counter unless DndContext is
    // given an id, and that counter does not start in the same place on the server as in
    // the browser: the page then fails to hydrate. Comparing the two is the whole test.
    const html = await (await page.request.get("/settings/categories")).text();
    const fromServer = [
      ...html.matchAll(/aria-roledescription="sortable" aria-describedby="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(fromServer.length).toBeGreaterThan(0);

    const inBrowser = await page
      .getByRole("button", { name: en.masterLists.dragHandle })
      .first()
      .getAttribute("aria-describedby");
    expect(fromServer).toContain(inBrowser);

    // And it still points at dnd-kit's keyboard instructions, rather than at nothing.
    await expect(page.locator(`#${inBrowser}`)).toHaveCount(1);
  });

  test("the lists are admin-only", async ({ page }) => {
    const manager = await makeStaff("MANAGER", "E2E Lists Manager");
    users.push(manager.id);
    await signIn(page, manager.mobile, "MANAGER");

    expect((await page.goto("/settings/categories"))?.status()).toBe(404);
    expect((await page.goto("/settings/reasons"))?.status()).toBe(404);
  });
});
