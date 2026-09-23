import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import gu from "../../messages/gu.json";
import hi from "../../messages/hi.json";

// "/" redirects by role; signed out that means the login screen, which is now the
// only public page (M02).
test("login page loads in English by default", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(en.app.name);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: en.auth.title })).toBeVisible();
});

test("NEXT_LOCALE=hi shows Hindi", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "hi", url: baseURL }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByRole("heading", { name: hi.auth.title })).toBeVisible();
});

test("the browser is told not to translate the app", async ({ page }) => {
  // The app has its own three languages and its own switch. A browser translating on
  // top rewrote the switcher into one script, and would rewrite names and amounts too.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("translate", "no");
  await expect(page.locator('meta[name="google"]')).toHaveAttribute("content", "notranslate");
});

test("NEXT_LOCALE=gu shows Gujarati", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "gu", url: baseURL }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "gu");
  await expect(page.getByRole("heading", { name: gu.auth.title })).toBeVisible();
});

test("a script font is fetched only when that script is on screen", async ({
  page,
  context,
  baseURL,
}) => {
  const fontsOn = async (locale: string) => {
    await context.clearCookies();
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.waitForLoadState("networkidle");
    return page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.includes(".woff")),
    );
  };

  // The Gujarati font is loaded through its unicode-range, so an English screen must
  // not pay for it.
  expect((await fontsOn("gu")).some((name) => /gujarati/i.test(name))).toBe(true);
  expect((await fontsOn("en")).some((name) => /gujarati|devanagari/i.test(name))).toBe(false);
});

test("web app manifest is linked and installable", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();

  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({
    display: "standalone",
    start_url: "/",
    short_name: "Follow-up",
  });
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).status()).toBe(200);
  }
});

test("service worker registers and activates", async ({ page }) => {
  await page.goto("/");
  // `ready` resolves while the worker may still be "activating"; poll until it settles.
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe("activated");
});

test("health check reports the database is up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, db: "up" });
});

test("offline page shows the offline message", async ({ page }) => {
  await page.goto("/offline");
  await expect(page.getByText(en.offline.title)).toBeVisible();
  await expect(page.getByRole("button", { name: en.offline.retry })).toBeVisible();
});

test("developer components page is hidden in production", async ({ request }) => {
  expect((await request.get("/dev/components")).status()).toBe(404);
});
