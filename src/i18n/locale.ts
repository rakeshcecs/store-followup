import { cookies } from "next/headers";
import { cache } from "react";
import { defaultLocale, isLocale, localeCookie, type Locale } from "@/i18n/config";
import { getUser } from "@/lib/auth";

// M18.02: the signed-in user's saved language wins, then the cookie, then English.
//
// Never throws — like getCurrentBranch() in M17. This runs for every request including
// /offline and the error boundary, so a database blip must not take down the render.
export const resolveLocale = cache(async (): Promise<Locale> => {
  try {
    // Already React-cached, and it returns null without a query when nobody is signed in.
    const user = await getUser();
    if (user) return user.language;
  } catch {
    // Database unreachable: fall back to the cookie rather than fail the page.
  }

  const cookieValue = (await cookies()).get(localeCookie)?.value;
  return isLocale(cookieValue) ? cookieValue : defaultLocale;
});
