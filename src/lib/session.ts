// Session store (M02). The cookie holds a random token; the database holds only its
// SHA-256, so a leaked database row cannot be replayed as a session.
//
// Not a JWT: a signed token stays valid until it expires, and the spec requires a
// deactivated user or a reset PIN to end every session within five minutes. A database
// row can be deleted, and `getSessionUser()` re-reads it on every request.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_MAX_AGE, sessionCookieOptions } from "@/lib/session-cookie";

export { SESSION_COOKIE, SESSION_MAX_AGE, sessionCookieOptions };
// How stale `lastSeenAt` may get before a read pushes the expiry out. Without this every
// screen would write a row on every request; a day is invisible against 30.
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex"); // 64 chars, fits VarChar(128)
}

export function expiryFromNow(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_MAX_AGE * 1000);
}

// Creates the row and sets the cookie. Called from the login action only.
export async function createSession(
  tx: Prisma.TransactionClient,
  userId: string,
  deviceInfo?: string | null,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await tx.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      deviceInfo: deviceInfo?.slice(0, 255) ?? null,
      expiresAt: expiryFromNow(),
    },
  });

  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  (await cookies()).delete(SESSION_COOKIE);
}

// Every device, e.g. after a PIN change or a manager's reset. `exceptTokenHash` keeps the
// device doing the changing signed in.
export async function destroyAllSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  exceptTokenHash?: string,
): Promise<void> {
  await tx.session.deleteMany({
    where: { userId, ...(exceptTokenHash ? { tokenHash: { not: exceptTokenHash } } : {}) },
  });
}

// Rolling 30 days, database half. The cookie half lives in proxy.ts, because a cookie
// cannot be written while a page renders.
export function needsTouch(lastSeenAt: Date, now = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() > TOUCH_AFTER_MS;
}

export async function touchSession(sessionId: string): Promise<void> {
  const now = new Date();
  await db.session.update({
    where: { id: sessionId },
    data: { lastSeenAt: now, expiresAt: expiryFromNow(now) },
  });
}
