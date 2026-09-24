import { describe, expect, it } from "vitest";
import { createStaffInput } from "@/lib/validation/staff";

const valid = {
  fullName: "Asha Patel",
  mobile: "9876543210",
  role: "MANAGER",
  homeBranchId: "branch-1",
};

describe("createStaffInput", () => {
  it("defaults to no extra branches and English", () => {
    const parsed = createStaffInput.parse({ ...valid });
    expect(parsed.extraBranchIds).toEqual([]);
    expect(parsed.language).toBe("en");
  });

  it("reads the chips' comma-separated list, because a multi-select would lose all but one", () => {
    // useActionForm reads the form with Object.fromEntries, which keeps only the last
    // value of a repeated key — hence one hidden input instead of <select multiple>.
    const parsed = createStaffInput.parse({ ...valid, extraBranchIds: "branch-2,branch-3" });
    expect(parsed.extraBranchIds).toEqual(["branch-2", "branch-3"]);
  });

  it("treats an empty list as none, not as a branch called nothing", () => {
    expect(createStaffInput.parse({ ...valid, extraBranchIds: "" }).extraBranchIds).toEqual([]);
    expect(createStaffInput.parse({ ...valid, extraBranchIds: " , " }).extraBranchIds).toEqual([]);
  });

  it("keeps the language the admin picked", () => {
    expect(createStaffInput.parse({ ...valid, language: "gu" }).language).toBe("gu");
    expect(createStaffInput.safeParse({ ...valid, language: "fr" }).success).toBe(false);
  });
});
