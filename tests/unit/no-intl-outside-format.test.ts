import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// One place decides how a date, a number or an amount is written (src/lib/format.ts).
// Anywhere else it is far too easy to pass "en" instead of "en-IN" and quietly print
// 100,000 where India writes 1,00,000 — which is exactly what M18.04 is about.
const FORMATTING =
  /toLocaleDateString|toLocaleTimeString|toLocaleString|new Intl\.|useFormatter|getFormatter/;
const HOME = join("src", "lib", "format.ts");
const EXEMPT = "format-exempt:"; // // format-exempt: <reason>

function sourceFiles(): string[] {
  return readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
    .map((name) => join("src", name))
    .filter((path) => !path.includes(join("src", "generated")) && path !== HOME);
}

describe("date and number formatting", () => {
  it("only happens in lib/format.ts", () => {
    const strays = sourceFiles().filter((path) => {
      const source = readFileSync(path, "utf8");
      return FORMATTING.test(source) && !source.includes(EXEMPT);
    });

    expect(strays, `Use the helpers in ${HOME} (or "// ${EXEMPT} <reason>")`).toEqual([]);
  });
});
