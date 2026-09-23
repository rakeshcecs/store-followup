import { getRequestConfig } from "next-intl/server";
import { isLocale, timeZone } from "@/i18n/config";
import { resolveLocale } from "@/i18n/locale";

// `locale` is set only when a caller asks for one explicitly, e.g.
// getTranslations({ locale: user.language }) in a report, an export or a worker job
// (M18.06). Ignoring it here would silently hand that caller the wrong language.
export default getRequestConfig(async ({ locale }) => {
  const resolved = isLocale(locale) ? locale : await resolveLocale();

  return {
    locale: resolved,
    timeZone, // Asia/Kolkata, whatever the server's own time zone is
    messages: (await import(`../../messages/${resolved}.json`)).default,
  };
});
