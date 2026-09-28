import type { ActionResult } from "@/lib/errors";

type Offline = Extract<ActionResult<never>, { ok: false }> & { code: "OFFLINE" };

// M01.05 "when the internet is lost…": a Server Action that never reached the server — no
// internet, a connection that dropped — rejects instead of returning a result. Left alone
// that goes to the error page and takes the form, with everything typed, with it. Here it
// comes back as a message on the form instead. Offline entry and sync were dropped (M19),
// so nothing is kept for later: the person saves again once they are back online, and the
// entry's clientId keeps a save that did get through from counting twice.
export async function reachServer<P extends Promise<unknown>>(
  call: P,
): Promise<Awaited<P> | Offline> {
  try {
    return await call;
  } catch (error) {
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    // fetch() reports a network failure as a TypeError; anything else is a real bug.
    if (!offline && !(error instanceof TypeError)) throw error;
    return { ok: false, code: "OFFLINE", message: "errors.offline" };
  }
}
