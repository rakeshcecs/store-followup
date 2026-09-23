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
      for (const [, key] of source.matchAll(KEY)) {
        if (!NAMESPACES.includes(key.split(".")[0] as string)) continue;
        if (!has(key)) missing.push(`${file}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
