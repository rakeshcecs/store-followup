// M19: what the phone's outbox holds and what /api/sync answers. Shared by the phone
// (the outbox, the service worker) and the server, so both read one shape.
//
// An entry is one form saved without internet: the same input the Server Action takes,
// plus where and when it was made. Records made on the phone point at each other by
// their clientId (a uuid) until the server has given them a real id — a visit for a
// customer who was added offline carries that customer's clientId as its customerId.
import { z } from "zod";
import { createCustomerInput } from "@/lib/validation/customer";
import { recordFollowUpResultInput, setFollowUpInput } from "@/lib/validation/follow-up";
import { recordSaleInput } from "@/lib/validation/sale";
import { recordVisitInput } from "@/lib/validation/visit";

export const ENTRY_KINDS = ["customer", "visit", "followUp", "result", "sale"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

// The largest batch one request takes; the phone sends the rest in the next one.
export const SYNC_BATCH = 50;

// A clientId made on the phone, as opposed to a server id (a cuid, which has no dashes).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isLocalId = (value: string | undefined | null): value is string =>
  typeof value === "string" && UUID.test(value);

export const INPUT_SCHEMA = {
  customer: createCustomerInput,
  visit: recordVisitInput,
  followUp: setFollowUpInput,
  result: recordFollowUpResultInput,
  sale: recordSaleInput,
} satisfies Record<EntryKind, z.ZodType>;

export const syncEntry = z.object({
  id: z.uuid(), // the entry's own id; also the clientId of the record it makes
  kind: z.enum(ENTRY_KINDS),
  at: z.iso.datetime(), // when it was saved on the phone
  branchId: z.string().trim().min(1).max(40), // the branch the phone was working in
  input: z.record(z.string(), z.unknown()), // checked against INPUT_SCHEMA[kind]
  // The customer's pending follow-up as the phone saw it. When someone else has changed
  // it since, a new follow-up would quietly replace theirs — so the server asks first.
  seenPendingId: z.string().max(40).nullable().optional(),
  force: z.boolean().optional(), // "Save anyway" after that question
});

export const syncRequest = z.object({ entries: z.array(syncEntry).min(1).max(SYNC_BATCH) });

export type SyncEntry = z.infer<typeof syncEntry>;

// What can go wrong with one entry that the person can fix (M19 "Needs your attention").
export const CONFLICTS = ["mobileTaken", "billTaken", "alreadyUpdated", "customerChanged"] as const;
export type ConflictReason = (typeof CONFLICTS)[number];

export type EntryResult =
  | { id: string; status: "ok"; data: Record<string, unknown> }
  | {
      id: string;
      status: "conflict";
      reason: ConflictReason;
      message: string; // next-intl key
      values?: Record<string, string | number>;
    }
  // Will not work however often it is sent: the message says why, the person discards it.
  | { id: string; status: "error"; message: string; values?: Record<string, string | number> }
  // Waits for an entry before it (its customer is not saved yet).
  | { id: string; status: "blocked" }
  // The server failed for a moment: sent again on the next sync.
  | { id: string; status: "retry" };
