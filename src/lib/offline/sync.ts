// M19: sending the outbox and refreshing the cache. Runs in the page (back online, app
// open, every 30 minutes) and in the service worker (Background Sync), so it uses
// nothing but fetch and the store.
import type { OfflineCache, OutboxEntry } from "@/lib/offline/types";
import {
  putOutboxEntry,
  readOutbox,
  removeFromOutbox,
  saveCache,
  wipeOfflineData,
} from "@/lib/offline/store";
import { SYNC_BATCH, type EntryResult } from "@/lib/sync/entries";

export const SYNC_TAG = "outbox-sync"; // Background Sync
export const CACHE_REFRESH_MS = 30 * 60 * 1000; // "refreshed every 30 minutes"

export type SyncSummary = {
  state: "done" | "offline" | "signedOut" | "busy";
  sent: number;
  synced: number;
  attention: number;
  waiting: number;
};

// One sync at a time across tabs and the worker. The server would not make duplicates
// anyway (every entry has its clientId), but two senders would fight over the answers.
async function withLock<T>(run: () => Promise<T>, busy: T): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return run();
  return locks.request("outbox-sync", { ifAvailable: true }, async (lock) => (lock ? run() : busy));
}

// What the person sees for one answer. ok → gone from the outbox; blocked → waits for
// the entry before it; retry → sent again next time.
export function applyResult(entry: OutboxEntry, result: EntryResult): OutboxEntry | null {
  switch (result.status) {
    case "ok":
      return null;
    case "conflict":
      return {
        ...entry,
        status: "attention",
        problem: { reason: result.reason, message: result.message, values: result.values },
      };
    case "error":
      return {
        ...entry,
        status: "attention",
        problem: { reason: "error", message: result.message, values: result.values },
      };
    case "blocked":
      return { ...entry, status: "blocked", problem: undefined };
    case "retry":
      return { ...entry, status: "waiting" };
  }
}

export async function syncOutbox(): Promise<SyncSummary> {
  const busy: SyncSummary = { state: "busy", sent: 0, synced: 0, attention: 0, waiting: 0 };
  return withLock(async () => {
    const summary: SyncSummary = { state: "done", sent: 0, synced: 0, attention: 0, waiting: 0 };
    // Entries that need the person are not sent until they have acted on them.
    const all = await readOutbox();
    const queue = all.filter((entry) => entry.status !== "attention");

    for (let start = 0; start < queue.length; start += SYNC_BATCH) {
      const batch = queue.slice(start, start + SYNC_BATCH);
      let response: Response;
      try {
        response = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            entries: batch.map((entry) => ({
              id: entry.id,
              kind: entry.kind,
              at: entry.at,
              branchId: entry.branchId,
              input: entry.input,
              ...(entry.seenPendingId !== undefined ? { seenPendingId: entry.seenPendingId } : {}),
              ...(entry.force ? { force: true } : {}),
            })),
          }),
        });
      } catch {
        return { ...summary, state: "offline" };
      }
      if (response.status === 401) {
        await wipeOfflineData();
        return { ...summary, state: "signedOut" };
      }
      if (!response.ok) return { ...summary, state: "offline" };

      const { results } = (await response.json()) as { results: EntryResult[] };
      summary.sent += batch.length;
      const done: string[] = [];
      for (const entry of batch) {
        const result = results.find((item) => item.id === entry.id);
        if (!result) continue;
        const next = applyResult(entry, result);
        if (!next) {
          done.push(entry.id);
          summary.synced += 1;
        } else if (next.status !== entry.status || next.problem !== entry.problem) {
          await putOutboxEntry(next);
        }
      }
      await removeFromOutbox(done);
    }

    const left = await readOutbox();
    summary.attention = left.filter((entry) => entry.status === "attention").length;
    summary.waiting = left.length - summary.attention;
    return summary;
  }, busy);
}

// A fresh copy of what the phone keeps. False when offline or signed out.
export async function refreshCache(): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch("/api/sync/cache", { credentials: "same-origin", cache: "no-store" });
  } catch {
    return false;
  }
  if (response.status === 401) {
    await wipeOfflineData();
    return false;
  }
  if (!response.ok) return false;
  const body = (await response.json()) as { key: string; keyId: string; cache: OfflineCache };
  await saveCache(body.key, body.keyId, body.cache);
  return true;
}
