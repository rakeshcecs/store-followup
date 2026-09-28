import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import { makeStaff, randomMobile, signIn } from "./helpers";

// M20 and M21 in the browser: the admin's switch decides whether staff see "Ask AI to
// fill" and the "Ask" box at all. The fill runs against the real model in tests/ai; one
// real question is asked here, to prove the answer streams through the production server.
// The switch is store-wide, so whatever it was before the spec is put back afterwards.

const KEYS = ["ai:enabled", "ai:dailyLimit"];

test.describe("AI note assistant", () => {
  test.skip(!process.env["OPENAI_API_KEY"], "the buttons only appear with a key on the server");
  // One switch for the whole store: the desktop and phone projects would flip it under
  // each other's feet. The panel itself is a phone-first component covered by its UI test.
  // The hooks check the project too: a skipped project's afterAll would otherwise put the
  // old value back while the other project is still in the middle of the test.
  const desktopOnly = () => test.info().project.name === "desktop";
  test.skip(() => !desktopOnly(), "store-wide switch: one project");

  const users: string[] = [];
  let customerId: string;
  let before: { key: string; value: unknown }[] = [];

  test.beforeAll(async () => {
    if (!desktopOnly()) return;
    before = await db.setting.findMany({
      where: { key: { in: KEYS } },
      select: { key: true, value: true },
    });
    // Start from off, whatever the shop had, so switching on is a real change (audit row).
    await db.setting.upsert({
      where: { key: "ai:enabled" },
      create: { key: "ai:enabled", value: false },
      update: { value: false },
    });
  });

  test.afterAll(async () => {
    if (!desktopOnly()) return;
    await db.setting.deleteMany({ where: { key: { in: KEYS } } });
    for (const row of before) {
      await db.setting.create({ data: { key: row.key, value: row.value as never } });
    }
    if (customerId) {
      await db.timelineEvent.deleteMany({ where: { customerId } });
      await db.customer.deleteMany({ where: { id: customerId } });
    }
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.aiSuggestionLog.deleteMany({ where: { userId: { in: users } } });
    await db.aiQuestionLog.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  test("the admin's switch shows and hides the button for staff", async ({ page, browser }) => {
    test.slow(); // two people, several saves
    const admin = await makeStaff("ADMIN", "E2E AI Admin");
    const seller = await makeStaff("SALESPERSON", "E2E AI Seller");
    users.push(admin.id, seller.id);
    const customer = await db.customer.create({
      data: {
        name: "E2E AI Customer",
        mobile: randomMobile(),
        assignedToId: seller.id,
        homeBranchId: seller.homeBranchId,
      },
    });
    customerId = customer.id;

    // Admin: Settings → AI assistant → on.
    await signIn(page, admin.mobile, "ADMIN");
    await page.goto("/settings");
    await page.getByRole("link", { name: new RegExp(en.settings.ai) }).click();
    await expect(page).toHaveURL(/\/settings\/ai$/);
    const s = en.aiSettings;
    await page.getByLabel(s.enabled).check();
    await page.getByLabel(s.dailyLimit).fill("100");
    await page.getByRole("button", { name: s.save }).click();
    await expect(page.getByText(s.saved).first()).toBeVisible();

    // Seller, in another browser: the button is on the visit form, and the profile's
    // button lands on the form with the panel open.
    const other = await browser.newContext();
    const seat = await other.newPage();
    await signIn(seat, seller.mobile, "SALESPERSON");
    await seat.goto(`/visits/new?customerId=${customer.id}`);
    await expect(seat.getByTestId("ai-ask")).toBeVisible();
    await seat.goto(`/customers/${customer.id}`);
    await seat.getByTestId("profile-ai").click();
    await expect(seat).toHaveURL(/\/visits\/new\?customerId=.*&ai=1$/);
    await expect(seat.getByTestId("ai-panel")).toBeVisible();
    // Only the admin has the settings screen.
    expect((await seat.request.get("/settings/ai")).status()).not.toBe(200);

    // M21: "Ask AI" is the salesperson's fourth menu item; a first-time asker gets the
    // suggested questions, and one tap asks the real model.
    await seat.goto("/today");
    await seat.getByRole("link", { name: en.nav.ask }).first().click();
    await expect(seat).toHaveURL(/\/ask$/);
    await expect(seat.getByTestId("ask-suggestions")).toBeVisible();
    await seat.getByRole("button", { name: en.ask.suggestions.mine.today }).click();
    await expect(seat.getByTestId("ask-answer")).toBeVisible({ timeout: 30_000 });
    await seat.getByTestId("ask-wrong").click();
    await expect(seat.getByTestId("ask-wrong-done")).toBeVisible();
    const asked = await db.aiQuestionLog.findFirstOrThrow({ where: { userId: seller.id } });
    expect(asked).toMatchObject({ question: en.ask.suggestions.mine.today, markedWrong: true });
    // Managers and admins have the box at the top of the Store overview.
    await page.goto("/overview");
    await expect(page.getByTestId("ask-box")).toBeVisible();
    await page.goto("/settings/ai");

    // Admin: off again — and the form is exactly as before M20.
    await page.getByLabel(s.enabled).uncheck();
    await page.getByRole("button", { name: s.save }).click();
    await expect(page.getByText(s.saved).first()).toBeVisible();
    await seat.goto(`/visits/new?customerId=${customer.id}`);
    await expect(seat.getByText(en.visits.lookingFor)).toBeVisible();
    await expect(seat.getByTestId("ai-ask")).toHaveCount(0);
    await seat.goto(`/customers/${customer.id}`);
    await expect(seat.getByTestId("profile-ai")).toHaveCount(0);
    await expect(seat.getByRole("link", { name: en.nav.ask })).toHaveCount(0);
    await seat.goto("/ask");
    await expect(seat.getByText(en.ask.off)).toBeVisible();
    await expect(seat.getByTestId("ask-box")).toHaveCount(0);
    await other.close();
    await page.goto("/overview");
    await expect(page.getByTestId("ask-box")).toHaveCount(0);

    const audits = await db.auditLog.findMany({
      where: { userId: admin.id, action: "setting:update" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((row) => [row.entityId, row.newValue])).toEqual(
      expect.arrayContaining([
        ["ai:enabled", true],
        ["ai:enabled", false],
      ]),
    );
  });
});
