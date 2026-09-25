// What a write needs to know besides its input and who is making it (M19). A Server
// Action takes all of it from the request; an offline entry replayed through /api/sync
// brings its own branch and time, because it happened earlier and maybe in another shop.
import { headers } from "next/headers";
import type { SessionUser } from "@/lib/auth";
import { getCurrentBranch } from "@/lib/current-branch";
import type { BranchChoice } from "@/lib/permissions";

export type WriteContext = {
  branch: BranchChoice; // the branch on screen, or the one the offline entry was made in
  device: string | null; // for the audit row
  now: Date; // when it happened: now, or when the offline entry was saved on the phone
  offline: boolean; // came through the offline sync: records get enteredOffline = true
};

export async function requestWriteContext(user: SessionUser): Promise<WriteContext> {
  return {
    branch: await getCurrentBranch(user),
    device: (await headers()).get("user-agent"),
    now: new Date(),
    offline: false,
  };
}

// P2002: a unique index said no.
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error["code"] === "P2002"
  );
}
