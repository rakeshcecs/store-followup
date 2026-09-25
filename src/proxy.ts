// Next 16 renamed middleware to proxy.ts. This is an optimistic check only: it looks at
// the session cookie and nothing else, never at the database, because it runs on every
// request including prefetches (node_modules/next/dist/docs/01-app/02-guides/authentication.md).
//
// The real guard is requireUser() inside every page and Server Action. This file only
// saves a signed-out visitor from landing on a 404, and rolls the cookie's 30 days.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session-cookie";

// Reachable without a session. Everything else needs one.
const PUBLIC_PATHS = ["/login", "/offline", "/api/health", "/manifest.webmanifest"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/serwist/")
  );
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    if (isPublic(pathname)) return NextResponse.next();
    // A fetch follows a redirect and reads the login page as a 200, so the phone would
    // never learn it is signed out and never wipe its offline copy (M19). Answer as the
    // route itself would.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "errors.unauthenticated" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    // Where they were heading, so login can send them back there.
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  // A cookie is all this can see — never whether the session behind it is still alive —
  // so it must not bounce anyone off /login. A stale cookie would be sent to "/", which
  // sends it back to /login, for ever. The login page redirects a signed-in visitor
  // itself, because it can actually ask.
  const response = NextResponse.next();

  // Rolling session: every navigation pushes the cookie's expiry out again. The row's
  // own expiresAt is extended in getSessionUser(), which is the half that can query.
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

export const config = {
  // Static files and images never need the check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|woff2)$).*)"],
};
