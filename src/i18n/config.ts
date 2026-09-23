// Languages match the Language enum in prisma/schema.prisma. No locale in the URL (M18).
// Kept import-free: next-intl aliases this file's neighbours into `next-intl/config`,
// and client components import it too.
export const locales = ["en", "hi", "gu"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const localeCookie = "NEXT_LOCALE";
export const localeCookieMaxAge = 60 * 60 * 24 * 365;
export const timeZone = "Asia/Kolkata";

// Every language in its own script: someone stranded in a script they cannot read
// must still be able to find their own. The same three words in all three message
// files, so they live here rather than as message keys.
export const languageNames: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  gu: "ગુજરાતી",
};

// Formatting needs the region, not just the language: Intl.NumberFormat("en") gives
// 100,000 but "en-IN" gives 1,00,000 (M18.04). The UI locale stays bare, because it
// is also <html lang> and the messages/<locale>.json file name.
export const intlLocales: Record<Locale, string> = {
  en: "en-IN",
  hi: "hi-IN",
  gu: "gu-IN",
};

export function isLocale(value: string | undefined): value is Locale {
  return locales.includes(value as Locale);
}
