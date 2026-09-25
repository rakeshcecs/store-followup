import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M16 "Done when: every create/update/cancel from M03–M15 appears in the audit log".
// A file that writes a business record must also write the audit row (or call a helper
// that does), so a new action cannot quietly skip it. File-level, like branch-scope.
const AUDITED_MODELS = [
  "customer",
  "visit",
  "followUp",
  "sale",
  "enquiry",
  "user",
  "userBranch",
  "branch",
  "department",
  "requirementCategory",
  "lostReason",
  "setting",
] as const;

// Helpers that write the audit row themselves.
const WRITERS = ["writeAudit", "writeStaffStatus", "moveCustomers", "anonymizeCustomer"];
const EXEMPT = "audit-exempt:"; // // audit-exempt: <reason>

function sourceFiles(): string[] {
  return ["src", "worker"]
    .flatMap((dir) =>
      readdirSync(dir, { recursive: true, encoding: "utf8" }).map((name) => join(dir, name)),
    )
    .filter((path) => /\.tsx?$/.test(path) && !path.includes(".test."))
    .filter((path) => !path.includes(join("src", "generated")));
}

function writePattern(model: string): RegExp {
  return new RegExp(
    `\\b(?:db|tx)\\.${model}\\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\\(`,
  );
}

describe("audit coverage", () => {
  it("recognises a write when it sees one", () => {
    expect(writePattern("sale").test("await tx.sale.update({")).toBe(true);
    expect(writePattern("sale").test("await tx.sale.findMany({")).toBe(false);
    expect(writePattern("user").test("await db.userBranch.create({")).toBe(false);
  });

  it("every file that writes a business record also writes the audit row", () => {
    const missing: string[] = [];
    for (const path of sourceFiles()) {
      const source = readFileSync(path, "utf8");
      if (source.includes(EXEMPT)) continue;
      if (WRITERS.some((writer) => source.includes(writer))) continue;
      for (const model of AUDITED_MODELS) {
        if (writePattern(model).test(source)) missing.push(`${path}: ${model}`);
      }
    }
    expect(
      missing,
      `Call writeAudit(tx, …) (or add "// ${EXEMPT} <reason>") in these files`,
    ).toEqual([]);
  });

  // Kept for at least 3 years (module prompt): nothing in the app removes audit rows.
  // A privacy delete clears personal fields inside them but keeps every row.
  it("nothing deletes audit rows", () => {
    const deleting = sourceFiles().filter((path) =>
      /\bauditLog\.delete(?:Many)?\(/.test(readFileSync(path, "utf8")),
    );
    expect(deleting).toEqual([]);
  });
});
