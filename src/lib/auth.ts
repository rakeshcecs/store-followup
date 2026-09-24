// `src/i18n/request.ts` imports this file, and next-intl aliases that file into
// `next-intl/config`. Nothing in this file's import graph may import `next-intl/server`,
// or the module graph becomes a cycle.
import { cookies } from "next/headers";
import { cache } from "react";
import type { Role } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertBranchAccess } from "@/lib/permissions";
import { hashToken, needsTouch, SESSION_COOKIE, touchSession } from "@/lib/session";

export type SessionUser = {
  id: string;
  role: Role;
  homeBranchId: string;
  branchIds: string[]; // home branch + extra branches
  language: Locale; // the language every screen, report and export uses (M18)
};

export type RequireUserOptions = {
  roles?: Role[];
  branchId?: string; // the branch of the record being touched (never "all")
};

// The session is re-read from the database on every request, which is what makes
// "deactivate a user and their sessions end" true within one request rather than
// within five minutes. With no cookie it returns null WITHOUT a query, because
// `src/i18n/locale.ts` calls this on every request and signed-out requests must stay
// database-free.
const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: {
        select: {
          id: true,
          role: true,
          status: true,
          homeBranchId: true,
          language: true,
          extraBranches: { select: { branchId: true } },
        },
      },
    },
  });

  // No user behind the session is possible for a moment when a user row is removed while
  // one of their requests is in flight (the e2e clean-up does this). The relation is
  // read in a second query, so treat it as signed out rather than crash on `.status`.
  if (!session?.user) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  if (needsTouch(session.lastSeenAt)) await touchSession(session.id);

  const { user } = session;
  return {
    id: user.id,
    role: user.role,
    homeBranchId: user.homeBranchId,
    branchIds: [user.homeBranchId, ...user.extraBranches.map((row) => row.branchId)],
    language: user.language,
  };
});

// Every Server Action and Route Handler calls this (CLAUDE.md "Always").
export async function requireUser(options: RequireUserOptions = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (options.roles && !options.roles.includes(user.role)) throw new AppError("FORBIDDEN");
  if (options.branchId) assertBranchAccess(user, options.branchId);
  return user;
}

// Null instead of throwing, for screens that render differently when signed out.
export async function getUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

// Where each role starts after logging in (M02 spec). The real screens arrive in
// M05 (/today) and M12 (/overview).
export function landingPath(role: Role): string {
  return role === "SALESPERSON" ? "/today" : "/overview";
}
