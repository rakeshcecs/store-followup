import { describe, expect, it } from "vitest";
import type { BranchScope } from "@/lib/permissions";
import { canResetPin, staffBranchWhere, staffInScope } from "@/lib/staff-scope";

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

describe("canResetPin", () => {
  const as = (role: "SALESPERSON" | "MANAGER" | "ADMIN", homeBranchId = "a", branchIds = ["a"]) =>
    ({ id: `me-${role}`, role, homeBranchId, branchIds, language: "en" }) as const;
  const staff = (
    role: "SALESPERSON" | "MANAGER" | "ADMIN",
    homeBranchId = "a",
    extras: string[] = [],
  ) => ({
    role,
    homeBranchId,
    extraBranches: extras.map((branchId) => ({ branchId })),
  });

  it("lets an admin reset anyone's", () => {
    for (const role of ["SALESPERSON", "MANAGER", "ADMIN"] as const) {
      expect(canResetPin(as("ADMIN"), staff(role, "b"))).toBe(true);
    }
  });

  it("lets a manager reset only the salespeople of their branches", () => {
    expect(canResetPin(as("MANAGER"), staff("SALESPERSON", "a"))).toBe(true);
    expect(canResetPin(as("MANAGER"), staff("SALESPERSON", "b", ["a"]))).toBe(true); // works in A too
    expect(canResetPin(as("MANAGER"), staff("SALESPERSON", "b"))).toBe(false);
  });

  // The reset PIN is shown to the manager, who could then sign in as that person.
  it("never lets a manager reset an admin's or another manager's", () => {
    expect(canResetPin(as("MANAGER"), staff("ADMIN", "a"))).toBe(false);
    expect(canResetPin(as("MANAGER"), staff("MANAGER", "a"))).toBe(false);
  });

  it("never lets a salesperson reset anyone's", () => {
    expect(canResetPin(as("SALESPERSON"), staff("SALESPERSON", "a"))).toBe(false);
  });
});
