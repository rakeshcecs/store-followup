import { cookies } from "next/headers";
import { getUser } from "@/lib/auth";
import { getCurrentBranch } from "@/lib/current-branch";
import { SESSION_COOKIE } from "@/lib/session";
import { loadOfflineCache, offlineKey } from "@/lib/sync/cache";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// M19: what the phone keeps for working offline, fetched on every online app open and
// every 30 minutes, with the session's encryption key. A 401 tells the phone the session
// is over, and it clears everything it kept.
export async function GET() {
  const user = await getUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!user || !token) {
    return Response.json({ error: "errors.unauthenticated" }, { status: 401, headers: NO_STORE });
  }
  const cache = await loadOfflineCache(user, await getCurrentBranch(user), new Date());
  return Response.json({ ...offlineKey(token), cache }, { headers: NO_STORE });
}
