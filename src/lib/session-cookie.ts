// Cookie name and attributes only, with no imports at all: `proxy.ts` needs them and
// must not pull Prisma or next/headers into the proxy runtime, while `src/lib/session.ts`
// needs the same values for the database half.
export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, rolling

export function sessionCookieOptions() {
  return {
    httpOnly: true, // the browser never reads it; only the server does
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
