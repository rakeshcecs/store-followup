"use client";

import { useTranslations } from "next-intl";
import type { MessageValues } from "@/lib/errors";

// Turns an ActionResult's `message` into text. That field is a next-intl key chosen by
// the server at run time, so it is a plain string and cannot be checked against the
// message files by the compiler. This is the one place that cast lives; everywhere else
// keys stay type-checked. tests/unit/message-keys.test.ts covers those runtime keys.
//
// `values` fills the placeholders in that message ("already used by {name}"). The server
// sends the values, never the sentence, so the screen stays in the reader's language.
export function useErrorMessage(): (key: string, values?: MessageValues) => string {
  const t = useTranslations();
  return (key, values) => t(key as Parameters<typeof t>[0], values);
}
