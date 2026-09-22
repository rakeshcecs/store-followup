// Languages match the Language enum in prisma/schema.prisma. No locale in the URL (M18).
export const locales = ["en", "hi", "gu"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const localeCookie = "NEXT_LOCALE";
export const timeZone = "Asia/Kolkata";

export function isLocale(value: string | undefined): value is Locale {
  return locales.includes(value as Locale);
}
