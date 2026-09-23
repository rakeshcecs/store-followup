// Which staff rows a user may see (M03).
//
// `branchWhere()` from src/lib/permissions.ts cannot be used here: User has no branchId.
// A person belongs to their home branch and, through UserBranch, to any extras, so the
// filter has to look at both — the same shape as the staff count in
// src/app/(admin)/branches/page.tsx.
import type { BranchScope } from "@/lib/permissions";

export type StaffBranchWhere =
  | Record<string, never>
  | {
      OR: [
        { homeBranchId: { in: string[] } },
        { extraBranches: { some: { branchId: { in: string[] } } } },
      ];
    };

// An admin looking at "All branches" adds no filter at all.
export function staffBranchWhere(scope: BranchScope): StaffBranchWhere {
  if (scope.all) return {};
  return {
    OR: [
      { homeBranchId: { in: scope.branchIds } },
      { extraBranches: { some: { branchId: { in: scope.branchIds } } } },
    ],
  };
}

// True when this user is inside the scope — the read-back check after a write, and the
// guard before editing someone else's row.
export function staffInScope(
  staff: { homeBranchId: string; extraBranches?: { branchId: string }[] },
  scope: BranchScope,
): boolean {
  if (scope.all) return true;
  const branchIds = new Set([
    staff.homeBranchId,
    ...(staff.extraBranches ?? []).map((row) => row.branchId),
  ]);
  return scope.branchIds.some((branchId) => branchIds.has(branchId));
}
