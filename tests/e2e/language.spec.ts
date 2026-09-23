import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
import gu from "../../messages/gu.json";

// M18.02 on the login screen, where nobody is signed in yet. The signed-in half —
// a saved language beating the cookie — is covered by tests/e2e/auth.spec.ts and
// tests/db/language-action.test.ts.
test("a visitor can change the language and it sticks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByRole("button", { name: en.language.switch }).click();
  await page.getByRole("menuitemradio", { name: "ગુજરાતી" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "gu");
  await expect(page.getByRole("heading", { name: gu.auth.title })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "gu");

  await page.getByRole("button", { name: gu.language.switch }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
