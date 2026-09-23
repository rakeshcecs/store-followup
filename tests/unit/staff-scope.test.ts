import { describe, expect, it } from "vitest";
import type { BranchScope } from "@/lib/permissions";
import { staffBranchWhere, staffInScope } from "@/lib/staff-scope";

const all: BranchScope = { all: true };
const one: BranchScope = { all: false, branchIds: ["branch-1"] };

describe("staffBranchWhere", () => {
  it("adds no filter for an admin looking at every branch", () => {
    expect(staffBranchWhere(all)).toEqual({});
  });

  it("matches both the home branch and an extra branch", () => {
    expect(staffBranchWhere(one)).toEqual({
      OR: [
        { homeBranchId: { in: ["branch-1"] } },
        { extraBranches: { some: { branchId: { in: ["branch-1"] } } } },
      ],
    });
  });
});

describe("staffInScope", () => {
  it("lets an admin on all branches reach anyone", () => {
    expect(staffInScope({ homeBranchId: "branch-9" }, all)).toBe(true);
  });

  it("matches on the home branch", () => {
    expect(staffInScope({ homeBranchId: "branch-1" }, one)).toBe(true);
  });

  it("matches a manager who only covers the branch as an extra", () => {
    const manager = { homeBranchId: "branch-2", extraBranches: [{ branchId: "branch-1" }] };
    expect(staffInScope(manager, one)).toBe(true);
  });

  it("refuses someone from another branch entirely", () => {
    expect(staffInScope({ homeBranchId: "branch-2", extraBranches: [] }, one)).toBe(false);
  });
});
