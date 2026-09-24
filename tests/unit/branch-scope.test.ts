import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every query on a branch-scoped model must go through the helpers in lib/permissions,
// otherwise one forgotten `where` lets a manager read another branch's records (M17).
// File-level on purpose: it is loud and needs no custom ESLint plugin.
//
// BR-16 (customers are shared across branches) needs no check here: Customer has no
// branchId column, so branchWhere() on a customer query is already a type error.
const SCOPED_MODELS = [
  "visit",
  "followUp",
  "sale",
  "campaign",
  "importJob",
  "whatsAppMessage",
] as const;

const HELPERS = ["branchWhere", "branchWhereShared", "writeBranchId"];
const EXEMPT = "branch-scope-exempt:"; // // branch-scope-exempt: <reason>

function sourceFiles(): string[] {
  return readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
    .map((name) => join("src", name))
    .filter((path) => !path.includes(join("src", "generated")));
}

// `db.followUp.` / `tx.visit.` as written in the source. Built with escaped backslashes:
// in a template literal a bare `\b` is a backspace character, which is how this check
// once matched nothing at all and passed for every file (found 24 Sep 2026).
function queryPattern(model: string): RegExp {
  return new RegExp(`\\b(?:db|tx)\\.${model}\\.`);
}

describe("branch scoping", () => {
  it("recognises a query when it sees one", () => {
    expect(queryPattern("followUp").test("await db.followUp.findMany({})")).toBe(true);
    expect(queryPattern("sale").test("await tx.sale.count({})")).toBe(true);
    expect(queryPattern("sale").test("await db.saleItem.count({})")).toBe(false);
  });

  it("every query on a branch-scoped model uses a permissions helper", () => {
    const unscoped: string[] = [];

    for (const path of sourceFiles()) {
      const source = readFileSync(path, "utf8");
      if (source.includes(EXEMPT)) continue;
      if (HELPERS.some((helper) => source.includes(helper))) continue;

      for (const model of SCOPED_MODELS) {
        if (queryPattern(model).test(source)) unscoped.push(`${path}: ${model}`);
      }
    }

    expect(
      unscoped,
      `Add ...branchWhere(scope) (or "// ${EXEMPT} <reason>") in these files`,
    ).toEqual([]);
  });
});
