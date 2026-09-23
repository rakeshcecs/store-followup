import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { makeStaff, signIn } from "./helpers";

// M01 shipped these screens closed behind a dev-only stub. M02 replaced that with real
// login, so "closed" now means: a signed-out visitor is sent to the login screen, and a
// signed-in non-admin is told the screen does not exist.
test.describe("admin branches", () => {
  const created: string[] = [];

  test.afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: created } } });
    await db.$disconnect();
  });

  test("sends a signed-out visitor to the login screen", async ({ request }) => {
    for (const path of ["/branches", "/branches/new"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers()["location"], path).toContain("/login?next=");
    }
  });

  test("does not exist for a salesperson", async ({ page }) => {
    const user = await makeStaff("SALESPERSON", "E2E Branch Visitor");
    created.push(user.id);
    await signIn(page, user.mobile, "SALESPERSON");

    for (const path of ["/branches", "/branches/new"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });
});
