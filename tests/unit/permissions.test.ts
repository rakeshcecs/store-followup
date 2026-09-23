import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  ALL_BRANCHES,
  allowedBranchIds,
  assertBranchAccess,
  branchScope,
  branchWhere,
  branchWhereShared,
  canAccessBranch,
  canSeeAllBranches,
  writeBranchId,
} from "@/lib/permissions";

const A = "branch-a";
const B = "branch-b";

const sales: SessionUser = {
  id: "u1",
  role: "SALESPERSON",
  homeBranchId: A,
  branchIds: [A],
  language: "en",
};
const manager: SessionUser = {
  id: "u2",
  role: "MANAGER",
  homeBranchId: A,
  branchIds: [A, B],
  language: "en",
};
const admin: SessionUser = {
  id: "u3",
  role: "ADMIN",
  homeBranchId: A,
  branchIds: [A],
  language: "en",
};

describe("allowedBranchIds", () => {
  it("puts the home branch first and removes duplicates", () => {
    const user: SessionUser = { ...manager, homeBranchId: B, branchIds: [A, B, A] };
    expect(allowedBranchIds(user)).toEqual([B, A]);
  });
});

describe("canAccessBranch", () => {
  it("allows a manager only their own branches", () => {
    expect(canAccessBranch(manager, A)).toBe(true);
    expect(canAccessBranch(manager, B)).toBe(true);
    expect(canAccessBranch(manager, "branch-c")).toBe(false);
  });

  it("allows an admin any branch, with or without a UserBranch row", () => {
    expect(canAccessBranch(admin, "branch-c")).toBe(true);
  });

  it("allows a salesperson only their home branch", () => {
    expect(canAccessBranch(sales, B)).toBe(false);
  });
});

describe("assertBranchAccess", () => {
  it("throws FORBIDDEN for another branch", () => {
    expect(() => assertBranchAccess(manager, "branch-c")).toThrow(AppError);
    try {
      assertBranchAccess(manager, "branch-c");
    } catch (error) {
      expect((error as AppError).code).toBe("FORBIDDEN");
      expect((error as AppError).message).toBe("branch.errors.noAccess");
    }
  });

  it("passes for an allowed branch", () => {
    expect(() => assertBranchAccess(manager, B)).not.toThrow();
  });
});

describe("canSeeAllBranches", () => {
  it("is admin only", () => {
    expect(canSeeAllBranches(admin)).toBe(true);
    expect(canSeeAllBranches(manager)).toBe(false);
    expect(canSeeAllBranches(sales)).toBe(false);
  });
});

describe("branchScope", () => {
  it("gives an admin every branch for 'all'", () => {
    expect(branchScope(admin, ALL_BRANCHES)).toEqual({ all: true });
  });

  it("refuses 'all' for a manager and a salesperson", () => {
    expect(() => branchScope(manager, ALL_BRANCHES)).toThrow(AppError);
    expect(() => branchScope(sales, ALL_BRANCHES)).toThrow(AppError);
  });

  it("narrows to the chosen branch", () => {
    expect(branchScope(manager, B)).toEqual({ all: false, branchIds: [B] });
  });

  it("refuses a branch the user is not in", () => {
    expect(() => branchScope(manager, "branch-c")).toThrow(AppError);
  });

  it("falls back to every branch the user belongs to", () => {
    expect(branchScope(manager, undefined)).toEqual({ all: false, branchIds: [A, B] });
  });
});

describe("branchWhere", () => {
  it("filters by the scope's branches", () => {
    expect(branchWhere({ all: false, branchIds: [A] })).toEqual({ branchId: { in: [A] } });
  });

  it("adds no filter for an admin on all branches", () => {
    expect(branchWhere({ all: true })).toEqual({});
  });
});

describe("branchWhereShared", () => {
  it("also matches rows that belong to every branch", () => {
    expect(branchWhereShared({ all: false, branchIds: [A] })).toEqual({
      OR: [{ branchId: { in: [A] } }, { branchId: null }],
    });
  });

  it("adds no filter for an admin on all branches", () => {
    expect(branchWhereShared({ all: true })).toEqual({});
  });
});

describe("writeBranchId", () => {
  it("writes to the current branch", () => {
    expect(writeBranchId(manager, B)).toBe(B);
  });

  it("falls back to the home branch when no branch is chosen", () => {
    expect(writeBranchId(manager, undefined)).toBe(A);
  });

  it("refuses to write while 'All branches' is chosen", () => {
    try {
      writeBranchId(admin, ALL_BRANCHES);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("RULE");
      expect((error as AppError).field).toBe("branchId");
    }
  });

  it("refuses a branch the user is not in", () => {
    expect(() => writeBranchId(manager, "branch-c")).toThrow(AppError);
  });
});
