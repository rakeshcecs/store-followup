import { describe, expect, it } from "vitest";
import { createDepartmentInput } from "@/lib/validation/department";

// SOW 5.2: a department name is Text (50).
describe("createDepartmentInput", () => {
  it("takes a 50-character name and refuses 51", () => {
    expect(createDepartmentInput.safeParse({ name: "d".repeat(50) }).success).toBe(true);
    const over = createDepartmentInput.safeParse({ name: "d".repeat(51) });
    expect(over.error?.issues[0]?.message).toBe("departments.errors.nameTooLong");
  });
});
