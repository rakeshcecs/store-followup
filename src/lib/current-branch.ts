// The branch the user is currently looking at (M17). Kept in a cookie so it survives
// navigation and reloads; validated against the user on every read, so a stale or
// tampered cookie can never widen what they see.
import { cookies } from "next/headers";
import { cache } from "react";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  ALL_BRANCHES,
  allowedBranchIds,
  branchScope,
  canAccessBranch,
  canSeeAllBranches,
  isAdmin,
  type BranchChoice,
  type BranchScope,
} from "@/lib/permissions";

export const BRANCH_COOKIE = "branch"; // a Branch id, or the literal "all"
export const BRANCH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const isBranchActive = cache(async (branchId: string): Promise<boolean> => {
  const branch = await db.branch.findFirst({
    where: { id: branchId, status: "ACTIVE" },
    select: { id: true },
  });
  return branch !== null;
});

// Never throws: a bad cookie must not break a screen, it just falls back to the
// home branch. Deactivating a branch therefore also drops anyone parked on it.
export const getCurrentBranch = cache(async (user: SessionUser): Promise<BranchChoice> => {
  const value = (await cookies()).get(BRANCH_COOKIE)?.value;
  if (!value) return user.homeBranchId;
  if (value === ALL_BRANCHES) return canSeeAllBranches(user) ? ALL_BRANCHES : user.homeBranchId;
  if (!canAccessBranch(user, value)) return user.homeBranchId;
  return (await isBranchActive(value)) ? value : user.homeBranchId;
});

// The one call every screen and action makes before querying branch-scoped models.
export async function getBranchScope(user: SessionUser): Promise<BranchScope> {
  return branchScope(user, await getCurrentBranch(user));
}

// Name for the switcher and headings. Null when the choice is "all".
export async function getCurrentBranchName(choice: BranchChoice): Promise<string | null> {
  if (choice === ALL_BRANCHES) return null;
  const branch = await db.branch.findUnique({
    where: { id: choice },
    select: { name: true },
  });
  return branch?.name ?? null;
}

// Every branch the user may switch to: an admin reaches all active branches,
// everyone else only their own. Home branch first, then by name.
export async function switchableBranches(
  user: SessionUser,
): Promise<{ id: string; name: string }[]> {
  const branches = await db.branch.findMany({
    where: {
      status: "ACTIVE",
      ...(isAdmin(user) ? {} : { id: { in: allowedBranchIds(user) } }),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return [
    ...branches.filter((branch) => branch.id === user.homeBranchId),
    ...branches.filter((branch) => branch.id !== user.homeBranchId),
  ];
}
