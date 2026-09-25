// M19: the forms' way to save. With internet it is the Server Action, as before. Without
// it — or when the request never reaches the server — the entry goes into the phone's
// outbox and the form carries on as if saved: "Saved on phone. Will sync when online."
import type { ActionResult } from "@/lib/errors";
import { isoDate } from "@/lib/format";
import { addToOutbox, readCache, readOutbox } from "@/lib/offline/store";
import { SYNC_TAG } from "@/lib/offline/sync";
import type { OutboxEntry } from "@/lib/offline/types";
import { findByMobile, offlineView } from "@/lib/offline/view";
import { INPUT_SCHEMA, type EntryKind } from "@/lib/sync/entries";

export type Queued = { queued?: true };

// Offline, the next screen is a full page load (the service worker's copy), which takes
// the form's toast with it. The offline app shows it again if it was saved just now.
const SAVED_FLASH = "offline-saved-at";
const FLASH_FOR_MS = 10_000;

export function takeSavedFlash(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(SAVED_FLASH));
    window.sessionStorage.removeItem(SAVED_FLASH);
    return at > 0 && Date.now() - at < FLASH_FOR_MS;
  } catch {
    return false;
  }
}

function flashSaved(): void {
  try {
    window.sessionStorage.setItem(SAVED_FLASH, String(Date.now()));
  } catch {
    // Without storage the toast shows only until the page changes.
  }
}
type Input = Record<string, unknown>;

// Background Sync where the browser has it (Chrome, Android): the outbox is sent even if
// the app is closed before the internet comes back.
async function askForBackgroundSync(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const sync = (
      registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    )?.sync;
    await sync?.register(SYNC_TAG);
  } catch {
    // Not supported: the app sends it on its next open.
  }
}

function fail(
  code: "VALIDATION" | "CONFLICT" | "RULE",
  message: string,
  field?: string,
  values?: Record<string, string | number>,
): ActionResult<never> {
  return { ok: false, code, message, field, values };
}

// The record's own clientId doubles as the entry's id, so what the phone calls it before
// the sync is what the server finds it by afterwards.
function entryId(input: Input): string {
  const own = input["clientId"];
  if (typeof own === "string" && own) return own;
  return crypto.randomUUID();
}

export async function queueEntry<T>(
  kind: EntryKind,
  rawInput: Input,
  local: (input: Input, id: string) => T,
): Promise<ActionResult<T & Queued>> {
  const parsed = INPUT_SCHEMA[kind].safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("VALIDATION", issue?.message ?? "errors.validation", issue?.path.join("."));
  }

  const cache = await readCache();
  if (!cache) return fail("RULE", "sync.errors.notReady");
  if (!cache.branch) return fail("RULE", "branch.errors.pickOne", "branchId");

  const input: Input = { ...(parsed.data as Input) };
  const id = entryId(rawInput);
  if (kind === "customer") input["clientId"] = id;

  const today = isoDate(new Date());
  const view = offlineView(cache, await readOutbox(), today);

  // BR-01 on the phone too, as far as it can see: a number it already knows is that
  // customer, not a new one. The server checks again at sync.
  if (kind === "customer") {
    for (const field of ["mobile", "altMobile"] as const) {
      const value = input[field];
      const owner = typeof value === "string" ? findByMobile(view, value) : null;
      if (owner) {
        return fail("CONFLICT", "customers.errors.mobileTaken", field, { name: owner.name });
      }
    }
  }

  // Updated already, on this phone: the server would say the same.
  if (kind === "result") {
    const followUpId = String(input["id"]);
    const pending = [...view.customers.values()].some((row) => row.pending?.id === followUpId);
    const listed = view.followUps.some((row) => row.id === followUpId);
    const known = cache.followUps.some((row) => row.id === followUpId) || pending;
    if (known && !pending && !listed) {
      return fail("RULE", "followUpResult.errors.alreadyUpdated");
    }
  }

  // The pending follow-up this entry would replace, as the phone sees it now.
  const replacesPending =
    kind === "followUp" || (kind === "visit" && input["outcome"] === "DECIDE_LATER");
  const customer = view.customers.get(String(input["customerId"]));
  const seenPendingId = replacesPending && customer ? (customer.pending?.id ?? null) : undefined;

  const entry: OutboxEntry = {
    id,
    kind,
    at: new Date().toISOString(),
    branchId: cache.branch.id,
    userId: cache.user.id,
    input,
    ...(seenPendingId !== undefined ? { seenPendingId } : {}),
    status: "waiting",
  };
  try {
    await addToOutbox(entry);
  } catch {
    return fail("RULE", "sync.errors.notReady");
  }
  void askForBackgroundSync();
  flashSaved();
  return { ok: true, data: { ...local(input, id), queued: true } };
}

// A failed fetch, not an answer: the server never saw it.
function networkFailure(error: unknown): boolean {
  return !navigator.onLine || error instanceof TypeError;
}

export function offlineAware<T>(
  kind: EntryKind,
  action: (input: unknown) => Promise<ActionResult<T>>,
  local: (input: Input, id: string) => T,
) {
  return async (input: unknown): Promise<ActionResult<T & Queued>> => {
    if (navigator.onLine) {
      try {
        return (await action(input)) as ActionResult<T & Queued>;
      } catch (error) {
        if (!networkFailure(error)) throw error;
      }
    }
    return queueEntry(kind, (input ?? {}) as Input, local);
  };
}
