import type { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { syncRequest } from "@/lib/sync/entries";
import { runSyncEntries } from "@/lib/sync/run";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// M19: the phone sends its outbox here, oldest first, when it is back online (and on app
// open, and from Background Sync). Every entry gets its own answer. A 401 tells the phone
// the session is over, and it clears everything it kept.
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "errors.unauthenticated" }, { status: 401, headers: NO_STORE });
  }

  const parsed = syncRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "errors.validation" }, { status: 400, headers: NO_STORE });
  }

  try {
    const results = await runSyncEntries(
      parsed.data.entries,
      user,
      request.headers.get("user-agent"),
    );
    return Response.json({ results }, { headers: NO_STORE });
  } catch (error) {
    // The session ended half-way through (deactivated while syncing).
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      return Response.json({ error: "errors.unauthenticated" }, { status: 401, headers: NO_STORE });
    }
    throw error;
  }
}
