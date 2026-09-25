import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import {
  addToOutbox,
  cacheStamp,
  outboxCounts,
  putOutboxEntry,
  readCache,
  readOutbox,
  removeFromOutbox,
  saveCache,
  wipeOfflineData,
} from "@/lib/offline/store";
import { applyResult } from "@/lib/offline/sync";
import type { OfflineCache, OutboxEntry } from "@/lib/offline/types";
import { dependentsOf, findByMobile, offlineView, todayBuckets } from "@/lib/offline/view";
import { entryTime } from "@/lib/sync/run";
import { offlineKey } from "@/lib/sync/cache";
import { isLocalId, syncRequest } from "@/lib/sync/entries";

// M19 on the phone: what the offline screens show, how answers change the outbox, and
// the encrypted store itself (IndexedDB faked in memory, real Web Crypto).

const TODAY = "2026-09-25";
const ME = "user-me";
const key = (seed: string) => offlineKey(seed);

function makeCache(overrides: Partial<OfflineCache> = {}): OfflineCache {
  return {
    version: 1,
    savedAt: "2026-09-25T04:00:00.000Z",
    today: TODAY,
    user: { id: ME, name: "Ravi", role: "SALESPERSON", language: "en" },
    branch: { id: "branch-a", name: "Surat", city: "Surat" },
    lists: {
      categories: [
        { id: "cat-sherwani", name: "Sherwani" },
        { id: "cat-wedding", name: "Wedding Clothes" },
      ],
      reasons: [{ id: "reason-price", name: "Price" }],
      departments: [],
      staff: [
        { id: ME, name: "Ravi" },
        { id: "user-other", name: "Neha" },
      ],
      billAmountRequired: true,
    },
    customers: [
      {
        id: "cust-asha",
        name: "Asha Patel",
        mobile: "9825011111",
        altMobile: "9825022222",
        area: null,
        city: "Surat",
        assignedToId: ME,
        assignedToName: "Ravi",
        openEnquiryTitle: "Sherwani",
        pending: { id: "fu-asha", dueDate: TODAY, timeSlot: "EVENING", assignedToId: ME },
      },
      {
        id: "cust-neha",
        name: "Neha Shah",
        mobile: "9825033333",
        altMobile: null,
        area: null,
        city: null,
        assignedToId: "user-other",
        assignedToName: "Neha",
        openEnquiryTitle: null,
        pending: null,
      },
    ],
    followUps: [
      {
        id: "fu-asha",
        customerId: "cust-asha",
        customerName: "Asha Patel",
        mobile: "9825011111",
        enquiryTitle: "Sherwani",
        dueDate: TODAY,
        timeSlot: "EVENING",
        method: "CALL",
        reason: "Call about the fitting",
        notReachableCount: 2,
      },
    ],
    overdueCount: 0,
    ...overrides,
  };
}

function entry(
  kind: OutboxEntry["kind"],
  input: Record<string, unknown>,
  id = randomUUID(),
): OutboxEntry {
  return {
    id,
    kind,
    at: "2026-09-25T06:00:00.000Z",
    branchId: "branch-a",
    userId: ME,
    input: { clientId: id, ...input },
    status: "waiting",
  };
}

describe("offlineView", () => {
  it("finds a customer added offline by main or alternate number, typed any way", () => {
    const added = entry("customer", {
      name: "Offline Kiran",
      mobile: "98250 44444",
      altMobile: "9825055555",
      assignedToId: ME,
    });
    const view = offlineView(makeCache(), [added], TODAY);
    expect(findByMobile(view, "+91 98250-44444")?.id).toBe(added.id);
    expect(findByMobile(view, "9825055555")?.name).toBe("Offline Kiran");
    expect(findByMobile(view, "9825022222")?.id).toBe("cust-asha"); // alternate number
    expect(findByMobile(view, "9000000000")).toBeNull();
    expect(findByMobile(view, "12345")).toBeNull();
  });

  it("a follow-up updated offline leaves Today; 'not reachable' sets tomorrow and counts the miss", () => {
    const result = entry("result", { id: "fu-asha", result: "NOT_REACHABLE" });
    const view = offlineView(makeCache(), [result], TODAY);
    expect(view.followUps.map((row) => row.id)).toEqual([result.id]);
    expect(view.followUps[0]).toMatchObject({
      dueDate: "2026-09-26",
      timeSlot: "EVENING",
      method: "CALL",
      notReachableCount: 3,
    });
    expect(view.customers.get("cust-asha")?.pending?.id).toBe(result.id);
    const buckets = todayBuckets(view.followUps, TODAY);
    expect(buckets.dueToday).toEqual([]);
    expect(buckets.comingUp).toHaveLength(1);
  });

  it("'will visit' makes a VISIT follow-up on the day chosen; 'not interested' closes everything", () => {
    const visitResult = entry("result", {
      id: "fu-asha",
      result: "WILL_VISIT",
      nextDate: "2026-09-27",
    });
    const visitView = offlineView(makeCache(), [visitResult], TODAY);
    expect(visitView.followUps[0]).toMatchObject({ dueDate: "2026-09-27", method: "VISIT" });

    const lost = entry("result", {
      id: "fu-asha",
      result: "NOT_INTERESTED",
      lostReasonId: "reason-price",
    });
    const lostView = offlineView(makeCache(), [lost], TODAY);
    expect(lostView.followUps).toEqual([]);
    expect(lostView.customers.get("cust-asha")).toMatchObject({
      openEnquiryTitle: null,
      pending: null,
    });
  });

  it("a new customer's visit with a follow-up joins Today when it is mine, not when it is someone else's", () => {
    const customer = entry("customer", { name: "Kiran", mobile: "9825044444", assignedToId: ME });
    const followUpId = randomUUID();
    const visit = entry("visit", {
      customerId: customer.id,
      categoryIds: ["cat-wedding", "cat-sherwani"],
      outcome: "DECIDE_LATER",
      followUp: { clientId: followUpId, dueDate: TODAY, timeSlot: "MORNING", method: "WHATSAPP" },
    });
    const view = offlineView(makeCache(), [customer, visit], TODAY);
    const kiran = view.customers.get(customer.id)!;
    expect(kiran.openEnquiryTitle).toBe("Wedding Clothes, Sherwani");
    expect(kiran.pending).toMatchObject({ id: followUpId, dueDate: TODAY });
    // Morning before the cached evening one.
    expect(view.followUps.map((row) => row.id)).toEqual([followUpId, "fu-asha"]);

    const theirs = entry("followUp", {
      customerId: "cust-neha",
      followUp: { dueDate: TODAY, timeSlot: "MORNING", method: "CALL" },
    });
    const other = offlineView(makeCache(), [theirs], TODAY);
    expect(other.customers.get("cust-neha")?.pending?.id).toBe(theirs.id);
    expect(other.followUps.map((row) => row.id)).toEqual(["fu-asha"]);
  });

  it("a sale closes the enquiry and cancels the pending follow-up (BR-06)", () => {
    const sale = entry("sale", {
      customerId: "cust-asha",
      sale: { billNumber: "B1", billDate: TODAY, billAmount: 100 },
    });
    const view = offlineView(makeCache(), [sale], TODAY);
    expect(view.followUps).toEqual([]);
    expect(view.customers.get("cust-asha")).toMatchObject({
      openEnquiryTitle: null,
      pending: null,
    });
  });

  it("Today reaches 7 days ahead, no further (M11.07)", () => {
    const far = entry("followUp", {
      customerId: "cust-asha",
      followUp: { dueDate: "2026-10-10", timeSlot: "MORNING", method: "CALL" },
    });
    expect(offlineView(makeCache(), [far], TODAY).followUps).toEqual([]);
  });

  it("knows what depends on an entry, and what depends on that", () => {
    const customer = entry("customer", { name: "Kiran", mobile: "9825044444", assignedToId: ME });
    const followUpId = randomUUID();
    const visit = entry("visit", {
      customerId: customer.id,
      categoryIds: ["cat-sherwani"],
      outcome: "DECIDE_LATER",
      followUp: { clientId: followUpId, dueDate: TODAY, timeSlot: "MORNING", method: "CALL" },
    });
    const result = entry("result", { id: followUpId, result: "NOT_REACHABLE" });
    const unrelated = entry("sale", {
      customerId: "cust-asha",
      sale: { billNumber: "B1", billDate: TODAY },
    });
    const outbox = [customer, visit, result, unrelated];
    expect(dependentsOf(outbox, customer.id).map((row) => row.id)).toEqual([visit.id, result.id]);
    expect(dependentsOf(outbox, visit.id).map((row) => row.id)).toEqual([result.id]);
    expect(dependentsOf(outbox, unrelated.id)).toEqual([]);
  });
});

describe("answers from the server", () => {
  const base = entry("sale", { customerId: "cust-asha" });
  it("ok leaves the outbox, a conflict or error needs attention, blocked waits, retry stays", () => {
    expect(applyResult(base, { id: base.id, status: "ok", data: {} })).toBeNull();
    expect(
      applyResult(base, {
        id: base.id,
        status: "conflict",
        reason: "billTaken",
        message: "visits.errors.billTaken",
        values: { name: "Asha" },
      }),
    ).toMatchObject({
      status: "attention",
      problem: { reason: "billTaken", values: { name: "Asha" } },
    });
    expect(
      applyResult(base, { id: base.id, status: "error", message: "errors.notFound" }),
    ).toMatchObject({ status: "attention", problem: { reason: "error" } });
    expect(applyResult(base, { id: base.id, status: "blocked" })?.status).toBe("blocked");
    expect(applyResult(base, { id: base.id, status: "retry" })?.status).toBe("waiting");
  });

  it("the phone's clock never puts an entry in the future", () => {
    const now = new Date("2026-09-25T10:00:00.000Z");
    expect(entryTime("2026-09-24T10:00:00.000Z", now).toISOString()).toBe(
      "2026-09-24T10:00:00.000Z",
    );
    expect(entryTime("2026-09-30T10:00:00.000Z", now)).toBe(now);
    expect(entryTime("nonsense", now)).toBe(now);
  });

  it("a phone id is a uuid; a server id never is", () => {
    expect(isLocalId(randomUUID())).toBe(true);
    expect(isLocalId("cm1x2y3z4000008l0abcd1234")).toBe(false);
    expect(isLocalId(null)).toBe(false);
  });

  it("a batch holds 1 to 50 entries", () => {
    const one = {
      id: randomUUID(),
      kind: "visit",
      at: new Date().toISOString(),
      branchId: "b",
      input: {},
    };
    expect(syncRequest.safeParse({ entries: [one] }).success).toBe(true);
    expect(syncRequest.safeParse({ entries: [] }).success).toBe(false);
    expect(syncRequest.safeParse({ entries: Array(51).fill(one) }).success).toBe(false);
    expect(syncRequest.safeParse({ entries: [{ ...one, kind: "delete" }] }).success).toBe(false);
  });

  it("the session key is 32 bytes, fixed per session, different between sessions", () => {
    expect(Buffer.from(key("token-1").key, "base64")).toHaveLength(32);
    expect(key("token-1")).toEqual(key("token-1"));
    expect(key("token-1").keyId).not.toBe(key("token-2").keyId);
    expect(key("token-1").keyId).not.toContain(key("token-1").key.slice(0, 8));
  });
});

describe("the encrypted store", () => {
  beforeEach(async () => {
    await wipeOfflineData();
  });

  async function rawRows(): Promise<unknown[]> {
    const raw = new Dexie("store-followup-offline");
    await raw.open();
    const rows = [
      ...(await raw.table("customersCache").toArray()),
      ...(await raw.table("followupsCache").toArray()),
      ...(await raw.table("outbox").toArray()),
      ...(await raw.table("meta").toArray()),
    ];
    raw.close();
    return rows;
  }

  it("keeps the copy and the outbox encrypted: no name or number readable at rest", async () => {
    const { key: secret, keyId } = key("session-a");
    await saveCache(secret, keyId, makeCache());
    await addToOutbox(
      entry("customer", { name: "Offline Kiran", mobile: "9825044444", assignedToId: ME }),
    );

    const text = new TextDecoder().decode(
      new Uint8Array(
        (await rawRows()).flatMap((row) =>
          Object.values(row as Record<string, unknown>).flatMap((value) =>
            value instanceof ArrayBuffer
              ? [...new Uint8Array(value)]
              : [...new TextEncoder().encode(String(value))],
          ),
        ),
      ),
    );
    for (const secretText of [
      "Asha Patel",
      "9825011111",
      "Offline Kiran",
      "9825044444",
      "fitting",
    ]) {
      expect(text).not.toContain(secretText);
    }

    const cache = await readCache();
    expect(cache?.customers.map((customer) => customer.name).sort()).toEqual([
      "Asha Patel",
      "Neha Shah",
    ]);
    expect((await readOutbox())[0]?.input["name"]).toBe("Offline Kiran");
    expect(await cacheStamp()).toEqual({
      savedAt: "2026-09-25T04:00:00.000Z",
      branchId: "branch-a",
      language: "en",
    });
  });

  it("counts waiting and attention without the key, and keeps the order entries were saved in", async () => {
    const { key: secret, keyId } = key("session-a");
    await saveCache(secret, keyId, makeCache());
    const first = entry("customer", { name: "One", mobile: "9825044444", assignedToId: ME });
    const second = entry("sale", { customerId: "cust-asha" });
    await addToOutbox(first);
    await addToOutbox(second);
    await putOutboxEntry({
      ...first,
      status: "attention",
      problem: { reason: "error", message: "errors.notFound" },
    });
    expect(await outboxCounts()).toEqual({ waiting: 1, attention: 1 });
    expect((await readOutbox()).map((row) => row.id)).toEqual([first.id, second.id]);
    await removeFromOutbox([first.id]);
    expect((await readOutbox()).map((row) => row.id)).toEqual([second.id]);
  });

  it("a new session's key throws away what the old one kept, the outbox included", async () => {
    const a = key("session-a");
    await saveCache(a.key, a.keyId, makeCache());
    await addToOutbox(entry("sale", { customerId: "cust-asha" }));
    const b = key("session-b");
    await saveCache(
      b.key,
      b.keyId,
      makeCache({ user: { id: "user-2", name: "Neha", role: "SALESPERSON", language: "hi" } }),
    );
    expect(await readOutbox()).toEqual([]);
    expect((await readCache())?.user.id).toBe("user-2");
  });

  it("refreshing with the same key replaces the copy but keeps the outbox", async () => {
    const a = key("session-a");
    await saveCache(a.key, a.keyId, makeCache());
    await addToOutbox(entry("sale", { customerId: "cust-asha" }));
    await saveCache(a.key, a.keyId, makeCache({ customers: [], followUps: [] }));
    expect((await readCache())?.customers).toEqual([]);
    expect(await readOutbox()).toHaveLength(1);
  });

  it("wipe leaves nothing: no copy, no outbox, nothing to count", async () => {
    const a = key("session-a");
    await saveCache(a.key, a.keyId, makeCache());
    await addToOutbox(entry("sale", { customerId: "cust-asha" }));
    await wipeOfflineData();
    expect(await readCache()).toBeNull();
    expect(await readOutbox()).toEqual([]);
    expect(await outboxCounts()).toEqual({ waiting: 0, attention: 0 });
    expect(await cacheStamp()).toBeNull();
    await expect(addToOutbox(entry("sale", {}))).rejects.toThrow("offline-not-ready");
  });
});
