// Typed messages and locale for next-intl. This is what makes a key relative to a
// namespace — t("fields.name") inside useTranslations("branches") — a compile error
// when it is misspelled, and lets useLocale() return our Locale instead of string.
import type { Locale } from "@/i18n/config";
import type messages from "./messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
