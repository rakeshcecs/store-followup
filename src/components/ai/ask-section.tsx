import { getTranslations } from "next-intl/server";
import { AskBox } from "@/components/ai/ask-box";
import type { SessionUser } from "@/lib/auth";
import { isFirstTimeAsker } from "@/lib/ai/ask";
import { aiAvailable } from "@/lib/ai/suggest";

// The M21 "Ask" box where the admin's AI switch is on (and the server has a key): at the
// top of the Store overview, and on the Ask screen. Nothing at all when it is off.
export async function AskSection({ user }: { user: SessionUser }) {
  if (!(await aiAvailable())) return null;
  const t = await getTranslations("ask.suggestions");
  // M21.07: suggested questions for first-time users, in their role's words.
  const suggestions = (await isFirstTimeAsker(user.id))
    ? user.role === "SALESPERSON"
      ? [t("mine.today"), t("mine.visitWeek"), t("mine.notContacted"), t("mine.salesMonth")]
      : [
          t("store.today"),
          t("store.visitWeek"),
          t("store.wedding"),
          t("store.notContacted"),
          t("store.salesMonth"),
          t("store.performance"),
        ]
    : [];
  return <AskBox suggestions={suggestions} />;
}
