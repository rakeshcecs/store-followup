// Which staff rows a user may see (M03).
//
// `branchWhere()` from src/lib/permissions.ts cannot be used here: User has no branchId.
// A person belongs to their home branch and, through UserBranch, to any extras, so the
// filter has to look at both — the same shape as the staff count in
// src/app/(admin)/branches/page.tsx.
import type { Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import { accessScope, type BranchScope } from "@/lib/permissions";

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

// Who may reset whose PIN. An admin: anyone. A manager: only the salespeople who work in
// one of their branches (home or extra) — never an admin or another manager, or the reset
// PIN they are shown would let them sign in as that person.
export function canResetPin(
  user: SessionUser,
  target: { role: Role; homeBranchId: string; extraBranches?: { branchId: string }[] },
): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role !== "MANAGER" || target.role !== "SALESPERSON") return false;
  return staffInScope(target, accessScope(user));
}
