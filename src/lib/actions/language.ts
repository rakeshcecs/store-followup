"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { localeCookie, localeCookieMaxAge } from "@/i18n/config";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { safeAction } from "@/lib/safe-action";
import { setLanguageInput } from "@/lib/validation/language";

// Public on purpose: M18.02 puts this on the login screen, before anyone is signed in.
// It writes User.language only for the caller's own already-resolved session, and the
// value is bounded by a three-item enum, so nothing can be reached or enumerated.
//
// No audit entry: this is a self-service screen preference, not a business record, and
// User.updatedAt already records it. M03 must still audit user:update when an ADMIN
// changes someone else's language.
export const setLanguage = safeAction({
  name: "setLanguage",
  schema: setLanguageInput,
  auth: false,
  handler: async ({ language }) => {
    // Database first: if the write fails the cookie is untouched, so the screen and the
    // saved choice can never disagree. One write, so no transaction is needed.
    const user = await getUser();
    if (user) {
      await db.user.update({
        where: { id: user.id },
        data: { language, updatedById: user.id },
      });
    }

    (await cookies()).set(localeCookie, language, {
      httpOnly: true, // only the server reads it; the screen gets its locale from the provider
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: localeCookieMaxAge,
    });

    // Every screen's text changes.
    revalidatePath("/", "layout");
    return { language };
  },
});
