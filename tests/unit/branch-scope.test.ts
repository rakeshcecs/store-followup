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

describe("branch scoping", () => {
  it("every query on a branch-scoped model uses a permissions helper", () => {
    const unscoped: string[] = [];

    for (const path of sourceFiles()) {
      const source = readFileSync(path, "utf8");
      if (source.includes(EXEMPT)) continue;
      if (HELPERS.some((helper) => source.includes(helper))) continue;

      for (const model of SCOPED_MODELS) {
        if (new RegExp(`\b(?:db|tx)\.${model}\.`).test(source)) unscoped.push(`${path}: ${model}`);
      }
    }

    expect(
      unscoped,
      `Add ...branchWhere(scope) (or "// ${EXEMPT} <reason>") in these files`,
    ).toEqual([]);
  });
});
