// Branch permissions (M17). Pure functions only: no `next/headers`, no database.
// Anything that needs a request or the database lives in `src/lib/current-branch.ts`.
//
// Membership vs authority: `allowedBranchIds()` is the branches a user *belongs* to
// (home branch + extras). `canAccessBranch()` is what they may *reach* — an ADMIN
// reaches every branch, whether or not they have a UserBranch row for it.
//
// Reading a record of a branch-scoped model (Visit, FollowUp, Sale, ImportJob,
// ImportJob), always through the scope, and NOT_FOUND so nothing leaks:
//
//   const visit = await db.visit.findFirst({ where: { id, ...branchWhere(scope) } });
//   if (!visit) throw new AppError("NOT_FOUND");
//
// Customers are shared across branches (BR-16) and must NEVER be branch-filtered.
import type { SessionUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";

// Cookie and UI value for an admin looking at every branch at once.
export const ALL_BRANCHES = "all";

export type BranchChoice = string | typeof ALL_BRANCHES;

// A resolved read scope. `all: true` can only ever come from an ADMIN.
export type BranchScope = { all: true } | { all: false; branchIds: string[] };

export function isAdmin(user: SessionUser): boolean {
  return user.role === "ADMIN";
}

// Only an admin gets the "All branches" choice.
export function canSeeAllBranches(user: SessionUser): boolean {
  return isAdmin(user);
}

// Home branch first (the switcher shows it first), then extras, without duplicates.
export function allowedBranchIds(user: SessionUser): string[] {
  return [...new Set([user.homeBranchId, ...user.branchIds])];
}

export function canAccessBranch(user: SessionUser, branchId: string): boolean {
  if (isAdmin(user)) return true;
  return allowedBranchIds(user).includes(branchId);
}

export function assertBranchAccess(user: SessionUser, branchId: string): void {
  if (!canAccessBranch(user, branchId)) {
    throw new AppError("FORBIDDEN", { message: "branch.errors.noAccess" });
  }
}

// Turns a cookie/param choice into a scope. Throws FORBIDDEN for "all" from a
// non-admin, or for a branch the user may not reach. No choice = their own branches.
export function branchScope(user: SessionUser, choice: BranchChoice | undefined): BranchScope {
  if (choice === ALL_BRANCHES) {
    if (!canSeeAllBranches(user)) {
      throw new AppError("FORBIDDEN", { message: "branch.errors.noAccess" });
    }
    return { all: true };
  }
  if (choice === undefined) return { all: false, branchIds: allowedBranchIds(user) };
  assertBranchAccess(user, choice);
  return { all: false, branchIds: [choice] };
}

// Every branch the user may reach, whatever the switcher shows. For opening ONE record by
// its id (a link from a customer's history): the switcher narrows lists and dashboards,
// but a manager with two branches must still open a sale made in the other one.
export function accessScope(user: SessionUser): BranchScope {
  if (canSeeAllBranches(user)) return { all: true };
  return { all: false, branchIds: allowedBranchIds(user) };
}

// For models where branchId is REQUIRED: Visit, FollowUp, Sale, ImportJob.
// An admin on "All branches" adds no filter (building the id list would cost a query).
export function branchWhere(scope: BranchScope): { branchId?: { in: string[] } } {
  if (scope.all) return {};
  return { branchId: { in: scope.branchIds } };
}

// For models where branchId is NULLABLE and null means "all branches":
// RequirementCategory, Festival, AuditLog. Returns an OR, so a caller that
// already uses OR must nest it: where: { AND: [branchWhereShared(scope), { ...rest }] }
export function branchWhereShared(scope: BranchScope): {
  OR?: [{ branchId: { in: string[] } }, { branchId: null }];
} {
  if (scope.all) return {};
  return { OR: [{ branchId: { in: scope.branchIds } }, { branchId: null }] };
}

// The single branch a new Visit, FollowUp, Sale or ImportJob is written to.
// A write never lands in "all": an admin must pick one branch first, otherwise the
// record would be filed under the wrong branch.
export function writeBranchId(user: SessionUser, choice: BranchChoice | undefined): string {
  if (choice === ALL_BRANCHES) {
    throw new AppError("RULE", { message: "branch.errors.pickOne", field: "branchId" });
  }
  if (choice === undefined) return user.homeBranchId;
  assertBranchAccess(user, choice);
  return choice;
}
