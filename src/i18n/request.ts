import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, localeCookie, timeZone } from "@/i18n/config";

// Locale comes from the cookie for now; M02 will prefer the signed-in user's language.
export default getRequestConfig(async () => {
  const cookieValue = (await cookies()).get(localeCookie)?.value;
  const locale = isLocale(cookieValue) ? cookieValue : defaultLocale;

  return {
    locale,
    timeZone,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
