import type { Role } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";

export type SessionUser = {
  id: string;
  role: Role;
  homeBranchId: string;
  branchIds: string[]; // home branch + extra branches
};

export type RequireUserOptions = {
  roles?: Role[];
  branchId?: string;
};

// Every Server Action and Route Handler calls this (CLAUDE.md "Always").
// Stub until M02 (login) reads the session cookie: nobody is signed in yet.
export async function requireUser(options: RequireUserOptions = {}): Promise<SessionUser> {
  void options;
  throw new AppError("UNAUTHENTICATED");
}
