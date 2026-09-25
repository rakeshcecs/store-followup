// The message files, for code that translates without a request: the worker (M14), the
// report builders (M13) and their tests. Screens keep using getTranslations().
import { createTranslator } from "next-intl";
import type en from "../../messages/en.json";
import type { Locale } from "@/i18n/config";

export type Messages = typeof en;

export async function loadMessages(locale: Locale): Promise<Messages> {
  return (await import(`../../messages/${locale}.json`)).default as Messages;
}

// Every translator a report needs, in one language.
export async function reportTranslators(locale: Locale) {
  const messages = await loadMessages(locale);
  return {
    t: createTranslator({ locale, messages, namespace: "reports" }),
    tFollowUps: createTranslator({ locale, messages, namespace: "followUps" }),
    tResult: createTranslator({ locale, messages, namespace: "followUpResult" }),
    tAll: createTranslator({ locale, messages }),
  };
}
