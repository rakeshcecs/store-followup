import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";

// Message keys written as whole keys in the source: zod messages, AppError messages
// and t("app.storeName")-style calls. Relative keys inside a useTranslations("branches")
// namespace are not matched, so this only checks what it can resolve.
const NAMESPACES = Object.keys(en);
const KEY = /"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
    .map((name) => join(dir, name))
    .filter((path) => !path.includes(`src${join("/", "generated")}`));
}

function has(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

describe("message keys used in the source", () => {
  it("all exist in messages/en.json", () => {
    const missing: string[] = [];

    for (const file of sourceFiles("src")) {
      const source = readFileSync(file, "utf8");
      // useTranslations("staff.errors") names a namespace, not a message: it resolves to
      // an object, and global.d.ts already type-checks it at compile time.
      const namespaces = new Set(
        [...source.matchAll(/(?:use|get)Translations\("([^"]+)"\)/g)].map(([, name]) => name),
      );

      for (const [, key] of source.matchAll(KEY)) {
        if (!NAMESPACES.includes(key.split(".")[0] as string)) continue;
        if (namespaces.has(key)) continue;
        // A key inside a namespace can start with a word that is also a top-level
        // namespace — t("errors.mobileInvalid") under getTranslations("customers") is
        // customers.errors.mobileInvalid, not the top-level errors.
        if (has(key)) continue;
        if ([...namespaces].some((namespace) => has(`${namespace}.${key}`))) continue;
        missing.push(`${file}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
