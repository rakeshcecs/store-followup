// M19: the phone's own database (IndexedDB through Dexie). Runs in the page and in the
// service worker. Tables:
//   outbox          forms saved without internet, oldest first, until the server has them
//   customersCache  the customers this person can search offline (one row each)
//   followupsCache  their follow-up list, for the Today screen
//   meta            the session's key, its id, and the short lists the forms offer
//
// Every stored value is encrypted with AES-GCM under a key that belongs to the session
// (src/lib/sync/cache.ts): the key is kept as a non-extractable CryptoKey, so page code
// can use it but never read it out. Only what the top bar counts without a key — how
// many entries wait and whether one needs attention — is plain. Everything goes on log
// out, at the login screen, and when the server says the session is over.
import Dexie, { type Table } from "dexie";
import type {
  CachedCustomer,
  CachedFollowUp,
  OfflineCache,
  OutboxEntry,
  OutboxStatus,
} from "@/lib/offline/types";

const DB_NAME = "store-followup-offline";

type Sealed = { iv: Uint8Array; data: ArrayBuffer };
type OutboxRow = Sealed & { seq?: number; id: string; status: OutboxStatus };
type CacheRow = Sealed & { id: string };
type MetaRow = { name: string; value: unknown };

class OfflineDb extends Dexie {
  outbox!: Table<OutboxRow, number>;
  customersCache!: Table<CacheRow, string>;
  followupsCache!: Table<CacheRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      outbox: "++seq, &id, status",
      customersCache: "id",
      followupsCache: "id",
      meta: "name",
    });
  }
}

let instance: OfflineDb | null = null;
function database(): OfflineDb {
  instance ??= new OfflineDb();
  return instance;
}

// ---- change notices: the top bar and open screens listen, in every tab and the worker ----

const CHANNEL = "store-followup-offline";

export function notifyChanged(): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("changed");
    channel.close();
  } catch {
    // No BroadcastChannel: this tab still hears its own event below.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANNEL));
}

export function onChanged(callback: () => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = callback;
  } catch {
    channel = null;
  }
  window.addEventListener(CHANNEL, callback);
  return () => {
    channel?.close();
    window.removeEventListener(CHANNEL, callback);
  };
}

// ---- the key ----

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function key(): Promise<CryptoKey | null> {
  try {
    const row = await database().meta.get("key");
    return (row?.value as CryptoKey | undefined) ?? null;
  } catch {
    return null;
  }
}

async function seal(cryptoKey: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return { iv, data };
}

async function open<T>(cryptoKey: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv as Uint8Array<ArrayBuffer> },
    cryptoKey,
    sealed.data,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// Everything, gone: log out, the login screen, a 401, another person's key.
export async function wipeOfflineData(): Promise<void> {
  try {
    instance?.close();
    instance = null;
    await Dexie.delete(DB_NAME);
  } catch {
    // Nothing stored, or storage blocked: nothing to clear.
  }
  notifyChanged();
}

// ---- the cache ----

// Saves a fresh copy from /api/sync/cache. A different key means a different session —
// another login on this phone — so whatever was kept under the old one is thrown away
// first, the outbox included (it was that session's, and it can no longer be read).
export async function saveCache(keyBase64: string, keyId: string, cache: OfflineCache) {
  const db = database();
  const stored = await db.meta.get("keyId");
  if (stored && stored.value !== keyId) {
    await wipeOfflineData();
    return saveCache(keyBase64, keyId, cache);
  }

  let cryptoKey = await key();
  if (!cryptoKey || !stored) {
    cryptoKey = await crypto.subtle.importKey(
      "raw",
      fromBase64(keyBase64),
      { name: "AES-GCM" },
      false, // non-extractable: usable, never readable
      ["encrypt", "decrypt"],
    );
  }

  const { customers, followUps, ...rest } = cache;
  const customerRows = await Promise.all(
    customers.map(async (customer) => ({ id: customer.id, ...(await seal(cryptoKey, customer)) })),
  );
  const followUpRows = await Promise.all(
    followUps.map(async (followUp) => ({ id: followUp.id, ...(await seal(cryptoKey, followUp)) })),
  );
  const info = await seal(cryptoKey, rest);

  await db.transaction("rw", [db.meta, db.customersCache, db.followupsCache], async () => {
    await db.meta.bulkPut([
      { name: "key", value: cryptoKey },
      { name: "keyId", value: keyId },
      { name: "userId", value: cache.user.id },
      { name: "savedAt", value: cache.savedAt },
      { name: "branchId", value: cache.branch?.id ?? null },
      { name: "language", value: cache.user.language },
      { name: "info", value: info },
    ]);
    await db.customersCache.clear();
    await db.customersCache.bulkAdd(customerRows);
    await db.followupsCache.clear();
    await db.followupsCache.bulkAdd(followUpRows);
  });
  notifyChanged();
}

// When the copy was made and for which branch, without the key (for "is it stale?").
export async function cacheStamp(): Promise<{
  savedAt: string;
  branchId: string | null;
  language: string | null;
} | null> {
  try {
    const db = database();
    const [savedAt, branchId, language] = await Promise.all([
      db.meta.get("savedAt"),
      db.meta.get("branchId"),
      db.meta.get("language"),
    ]);
    if (!savedAt) return null;
    return {
      savedAt: savedAt.value as string,
      branchId: (branchId?.value as string) ?? null,
      language: (language?.value as string) ?? null,
    };
  } catch {
    return null;
  }
}

export async function readCache(): Promise<OfflineCache | null> {
  try {
    const db = database();
    const cryptoKey = await key();
    const info = await db.meta.get("info");
    if (!cryptoKey || !info) return null;
    const rest = await open<Omit<OfflineCache, "customers" | "followUps">>(
      cryptoKey,
      info.value as Sealed,
    );
    const [customers, followUps] = await Promise.all([
      db.customersCache.toArray(),
      db.followupsCache.toArray(),
    ]);
    return {
      ...rest,
      customers: await Promise.all(customers.map((row) => open<CachedCustomer>(cryptoKey, row))),
      followUps: await Promise.all(followUps.map((row) => open<CachedFollowUp>(cryptoKey, row))),
    };
  } catch {
    // A key that no longer opens the data is as good as no data.
    return null;
  }
}

// ---- the outbox ----

export async function addToOutbox(entry: OutboxEntry): Promise<void> {
  const cryptoKey = await key();
  if (!cryptoKey) throw new Error("offline-not-ready");
  const db = database();
  await db.outbox.add({ id: entry.id, status: entry.status, ...(await seal(cryptoKey, entry)) });
  notifyChanged();
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  try {
    const cryptoKey = await key();
    if (!cryptoKey) return [];
    const rows = await database().outbox.orderBy("seq").toArray();
    return Promise.all(rows.map((row) => open<OutboxEntry>(cryptoKey, row)));
  } catch {
    return [];
  }
}

// Replaces the stored copy, keeping its place in the queue.
export async function putOutboxEntry(entry: OutboxEntry): Promise<void> {
  const cryptoKey = await key();
  if (!cryptoKey) return;
  const db = database();
  const row = await db.outbox.where("id").equals(entry.id).first();
  if (!row?.seq) return;
  await db.outbox.put({
    seq: row.seq,
    id: entry.id,
    status: entry.status,
    ...(await seal(cryptoKey, entry)),
  });
  notifyChanged();
}

export async function removeFromOutbox(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await database().outbox.where("id").anyOf(ids).delete();
  notifyChanged();
}

// For the top bar: no key needed, nothing decrypted.
export async function outboxCounts(): Promise<{ waiting: number; attention: number }> {
  try {
    const rows = await database().outbox.toArray();
    const attention = rows.filter((row) => row.status === "attention").length;
    return { waiting: rows.length - attention, attention };
  } catch {
    return { waiting: 0, attention: 0 };
  }
}
