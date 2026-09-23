// Lists what is missing, stale or untranslated in the Hindi and Gujarati message files.
// Run with `npm run i18n:check`. Exits 1 when anything is wrong, so CI catches it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import en from "../messages/en.json";
import gu from "../messages/gu.json";
import hi from "../messages/hi.json";
import { diffMessages, flatten, type MessageProblem } from "./lib/message-diff";

const LOCALES: [string, object][] = [
  ["hi", hi],
  ["gu", gu],
];

const LABEL: Record<MessageProblem["kind"], string> = {
  missing: "not translated yet",
  extra: "no longer in en.json",
  untranslated: "still the English text",
  placeholders: "wrong placeholders",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
    .map((name) => join(dir, name))
    .filter((path) => !path.includes(join("src", "generated")));
}

// Informational only: a screen can build a key at run time, so an unreferenced key is
// a hint to look, never a reason to fail a build.
function unreferencedKeys(): string[] {
  const source = sourceFiles("src")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  return [...flatten(en).keys()].filter((key) => {
    const last = key.split(".").pop() as string;
    return !source.includes(key) && !source.includes(`"${last}"`) && !source.includes(`.${last}`);
  });
}

const problems = LOCALES.flatMap(([locale, messages]) => diffMessages(en, locale, messages));

for (const [locale] of LOCALES) {
  const mine = problems.filter((problem) => problem.locale === locale);
  if (mine.length === 0) {
    console.log(`${locale}: all ${flatten(en).size} keys translated.`);
    continue;
  }
  console.log(`${locale}: ${mine.length} problem(s)`);
  for (const problem of mine) {
    console.log(
      `  ${problem.key} — ${LABEL[problem.kind]}${problem.detail ? `: ${problem.detail}` : ""}`,
    );
  }
}

const unused = unreferencedKeys();
if (unused.length > 0) {
  console.log(`\nNot referenced in src/ (check by hand, keys can be built at run time):`);
  for (const key of unused) console.log(`  ${key}`);
}

if (problems.length > 0) process.exitCode = 1;
