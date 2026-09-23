// Compares the translation files against English. Used by `npm run i18n:check` and by
// tests/unit/messages.test.ts, so there is exactly one implementation of the rules.

export type ProblemKind = "missing" | "extra" | "untranslated" | "placeholders";

export type MessageProblem = {
  locale: string;
  key: string;
  kind: ProblemKind;
  detail?: string;
};

// Values that are meant to read the same in every language.
export const SAME_AS_ENGLISH_OK = [
  "app.storeName", // "[STORE NAME]" until the client gives us the real one
  "branches.placeholders.name",
  "branches.placeholders.phone",
] as const;

export function flatten(messages: object, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = `${prefix}${key}`;
    if (typeof value === "object" && value !== null) {
      for (const [innerKey, innerValue] of flatten(value, `${path}.`))
        flat.set(innerKey, innerValue);
    } else {
      flat.set(path, String(value));
    }
  }
  return flat;
}

// The named arguments a message expects: "{name}" and the "count" in
// "{count, plural, one {# person} other {# people}}". A translator who drops one
// leaves a message that breaks at run time.
export function icuArgs(value: string): string[] {
  const names = new Set<string>();
  for (const [, name] of value.matchAll(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[,}]/g)) names.add(name);
  return [...names].sort();
}

export function diffMessages(
  english: object,
  locale: string,
  messages: object,
  sameAsEnglishOk: readonly string[] = SAME_AS_ENGLISH_OK,
): MessageProblem[] {
  const base = flatten(english);
  const other = flatten(messages);
  const problems: MessageProblem[] = [];

  for (const [key, englishValue] of base) {
    const value = other.get(key);
    if (value === undefined) {
      problems.push({ locale, key, kind: "missing" });
      continue;
    }

    const expected = icuArgs(englishValue);
    const actual = icuArgs(value);
    if (expected.join(",") !== actual.join(",")) {
      problems.push({
        locale,
        key,
        kind: "placeholders",
        detail: `expected {${expected.join("}, {")}}, found ${actual.length ? `{${actual.join("}, {")}}` : "none"}`,
      });
    }

    if (value === englishValue && !sameAsEnglishOk.includes(key)) {
      problems.push({ locale, key, kind: "untranslated", detail: englishValue });
    }
  }

  for (const key of other.keys()) {
    if (!base.has(key)) problems.push({ locale, key, kind: "extra" });
  }

  return problems;
}
