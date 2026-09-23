"use client";

import { useTranslations } from "next-intl";

// Turns an ActionResult's `message` into text. That field is a next-intl key chosen by
// the server at run time, so it is a plain string and cannot be checked against the
// message files by the compiler. This is the one place that cast lives; everywhere else
// keys stay type-checked. tests/unit/message-keys.test.ts covers those runtime keys.
export function useErrorMessage(): (key: string) => string {
  const t = useTranslations();
  return (key) => t(key as Parameters<typeof t>[0]);
}
