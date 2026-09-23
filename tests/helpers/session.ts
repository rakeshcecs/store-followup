// Signs a test in the way the app does: a real Session row, and the cookie store the
// test mocks onto next/headers hands back that row's token. Nothing here is a special
// test path — requireUser() runs its normal query against it.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashToken, SESSION_COOKIE } from "@/lib/session";

let token: string | null = null;

export async function signInAs(staffMobile: string | null): Promise<void> {
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

export function sessionCookieStore() {
  return {
    get: (name: string) => (name === SESSION_COOKIE && token ? { name, value: token } : undefined),
    set: () => {},
    delete: () => {
      token = null;
    },
  };
}
