import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import gu from "../../messages/gu.json";
import hi from "../../messages/hi.json";
import { db } from "@/lib/db";
import { makeStaff, signIn } from "./helpers";

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
  browser,
  baseURL,
}) => {
  // A context per locale: performance entries survive a same-context navigation, so a
  // shared page would report the previous locale's fonts as this one's.
  const fontsOn = async (locale: string) => {
    const context = await browser.newContext({ baseURL });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL! }]);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.waitForLoadState("networkidle");
    const files = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.includes(".woff")),
    );
    await context.close();
    return new Set(files.map((name) => name.split("/").pop()!));
  };

  const latin = await fontsOn("en");
  const gujarati = await fontsOn("gu");
  const devanagari = await fontsOn("hi");

  // next/font self-hosts with hashed file names, so a script font is recognised by being
  // fetched on its own screen and on no other: each script screen pays for exactly one
  // extra file, and the English screen pays for none of them.
  const extraGu = [...gujarati].filter((file) => !latin.has(file));
  const extraHi = [...devanagari].filter((file) => !latin.has(file));
  expect(extraGu).toHaveLength(1);
  expect(extraHi).toHaveLength(1);
  expect(extraGu).not.toEqual(extraHi);
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

// M19: a phone whose session cookie has expired must hear 401, not follow a redirect to
// the login page (read as a 200), or it never wipes its offline copy.
test("signed-out API calls get 401, not the login page", async ({ request }) => {
  const cache = await request.get("/api/sync/cache", { maxRedirects: 0 });
  expect(cache.status()).toBe(401);
  const sync = await request.post("/api/sync", { data: { entries: [] }, maxRedirects: 0 });
  expect(sync.status()).toBe(401);
  // Pages still send a signed-out visitor to log in.
  const page = await request.get("/today", { maxRedirects: 0 });
  expect(page.status()).toBe(307);
});

// M19: with no offline copy on the phone (never signed in here), the offline app says
// how to get one.
test("offline page without an offline copy says how to get one", async ({ page }) => {
  await page.goto("/offline");
  await expect(page.getByText(en.offlineApp.noData.title)).toBeVisible();
  await expect(page.getByRole("button", { name: en.offline.retry })).toBeVisible();
});

test("developer components page is hidden in production", async ({ page, request }) => {
  // Signed out, the proxy stops it before the page runs at all.
  const anonymous = await request.get("/dev/components", { maxRedirects: 0 });
  expect(anonymous.status()).toBe(307);

  // And the page itself refuses even the one role that can see everything else.
  const admin = await makeStaff("ADMIN", "E2E Dev Gallery Admin");
  try {
    await signIn(page, admin.mobile, "ADMIN");
    expect((await page.goto("/dev/components"))?.status()).toBe(404);
  } finally {
    await db.user.delete({ where: { id: admin.id } });
    await db.$disconnect();
  }
});
