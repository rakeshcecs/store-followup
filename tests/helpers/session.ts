// Signs a test in the way the app does: a real Session row, and the cookie store the
// test mocks onto next/headers hands back that row's token. Nothing here is a special
// test path — requireUser() runs its normal query against it.
import { randomBytes } from "node:crypto";
import { BRANCH_COOKIE } from "@/lib/current-branch";
import { PUSH_COOKIE } from "@/lib/push-device";
import { db } from "@/lib/db";
import { hashToken, SESSION_COOKIE } from "@/lib/session";

let token: string | null = null;
let branch: string | null = null;

// The branch the signed-in person is currently looking at — the switcher's cookie
// (M17). Without it every test runs on the user's home branch, which hides everything
// the switcher changes. Pass ALL_BRANCHES for an admin looking at every branch at once.
export function viewingBranch(branchId: string | null): void {
  branch = branchId;
}

export async function signInAs(staffMobile: string | null): Promise<void> {
  branch = null; // a new session starts on the person's home branch
  if (!staffMobile) {
    token = null;
    return;
  }

  const user = await db.user.findUniqueOrThrow({
    where: { mobile: staffMobile },
    select: { id: true },
  });

  token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

// The token of the session signInAs() created, for tests that check it was deleted.
export function currentSessionToken(): string | null {
  return token;
}

// The device's push subscription cookie (M14) is kept, so logging out can be tested to
// remove it. Only that one: the others keep their old behaviour for every other test.
let pushEndpoint: string | null = null;

export function sessionCookieStore() {
  return {
    get: (name: string) => {
      if (name === SESSION_COOKIE) return token ? { name, value: token } : undefined;
      if (name === BRANCH_COOKIE) return branch ? { name, value: branch } : undefined;
      if (name === PUSH_COOKIE) return pushEndpoint ? { name, value: pushEndpoint } : undefined;
      return undefined;
    },
    set: (name: string, value: string) => {
      if (name === PUSH_COOKIE) pushEndpoint = value;
    },
    delete: (name?: string) => {
      if (name === PUSH_COOKIE) pushEndpoint = null;
      else token = null;
    },
  };
}
