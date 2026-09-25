// M19: replays the phone's outbox. Each entry runs the same code as the Server Action
// (src/lib/writes/*) in its own transaction, in the order it was saved, and gets its own
// answer: ok, a conflict the person can fix, an error, or "try again later".
//
// branch-scope-exempt: follow-ups are looked up by the clientId the phone made for them
// and must belong to this user's own outbox; the writes they feed check access
// themselves (followUpAccessWhere, writeBranchId).
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { isLocalId, INPUT_SCHEMA, type EntryResult, type SyncEntry } from "@/lib/sync/entries";
import { isUniqueViolation, type WriteContext } from "@/lib/writes/context";
import { createCustomerCore } from "@/lib/writes/customer";
import { recordFollowUpResultCore, setFollowUpCore } from "@/lib/writes/follow-up";
import { recordSaleCore } from "@/lib/writes/sale";
import { recordVisitCore } from "@/lib/writes/visit";
import type { CreateCustomerInput } from "@/lib/validation/customer";
import type { RecordFollowUpResultInput, SetFollowUpInput } from "@/lib/validation/follow-up";
import type { RecordSaleInput } from "@/lib/validation/sale";
import type { RecordVisitInput } from "@/lib/validation/visit";

// An entry waiting for one before it: the customer it belongs to was added offline too
// and is not in the database yet.
class Blocked extends Error {}

// A customer or follow-up made on the phone, by its clientId → the real id. Only this
// user's own: a clientId is not a way into somebody else's records.
async function customerId(value: string, user: SessionUser): Promise<string> {
  if (!isLocalId(value)) return value;
  const row = await db.customer.findFirst({
    where: { clientId: value, createdById: user.id },
    select: { id: true },
  });
  if (!row) throw new Blocked();
  return row.id;
}

async function followUpId(value: string): Promise<string> {
  if (!isLocalId(value)) return value;
  const row = await db.followUp.findUnique({ where: { clientId: value }, select: { id: true } });
  if (!row) throw new Blocked();
  return row.id;
}

// "Customer changed by someone else": the pending follow-up the phone saw is no longer
// the pending one, and the new one would replace it (M08.06). Asked, not assumed.
async function assertPendingUnchanged(entry: SyncEntry, customer: string): Promise<void> {
  if (entry.force || entry.seenPendingId === undefined) return;
  // Sent again after its answer was lost: the pending one now is its own, not someone
  // else's change — the write below just answers the same again.
  const saved =
    entry.kind === "visit"
      ? await db.visit.findUnique({ where: { clientId: entry.id }, select: { id: true } })
      : await db.followUp.findUnique({ where: { clientId: entry.id }, select: { id: true } });
  if (saved) return;
  const seen = entry.seenPendingId === null ? null : await followUpId(entry.seenPendingId);
  const now = await db.followUp.findFirst({
    where: { customerId: customer, status: "PENDING" },
    select: { id: true },
  });
  if ((now?.id ?? null) !== seen) {
    throw new AppError("CONFLICT", { message: "sync.conflict.customerChanged" });
  }
}

// The phone's clock says when; it is never allowed to say "later than now".
export function entryTime(at: string, serverNow: Date): Date {
  const time = new Date(at);
  return Number.isNaN(time.getTime()) || time > serverNow ? serverNow : time;
}

async function runOne(
  entry: SyncEntry,
  user: SessionUser,
  ctx: WriteContext,
): Promise<Record<string, unknown>> {
  // The entry's id is the clientId of the record it makes, whatever the input says, so
  // the checks above and the write below look for the same thing.
  const parsed = INPUT_SCHEMA[entry.kind].safeParse({ ...entry.input, clientId: entry.id });
  if (!parsed.success) throw new AppError("VALIDATION");

  switch (entry.kind) {
    case "customer": {
      const input = parsed.data as CreateCustomerInput;
      return createCustomerCore(input, user, ctx);
    }
    case "visit": {
      const input = parsed.data as RecordVisitInput;
      const customer = await customerId(input.customerId, user);
      if (input.outcome === "DECIDE_LATER") await assertPendingUnchanged(entry, customer);
      return recordVisitCore({ ...input, customerId: customer }, user, ctx);
    }
    case "followUp": {
      const input = parsed.data as SetFollowUpInput;
      const customer = await customerId(input.customerId, user);
      await assertPendingUnchanged(entry, customer);
      return setFollowUpCore({ ...input, customerId: customer }, user, ctx);
    }
    case "result": {
      const input = parsed.data as RecordFollowUpResultInput;
      return recordFollowUpResultCore({ ...input, id: await followUpId(input.id) }, user, ctx);
    }
    case "sale": {
      const input = parsed.data as RecordSaleInput;
      return recordSaleCore(
        {
          ...input,
          customerId: await customerId(input.customerId, user),
          ...(input.followUpId ? { followUpId: await followUpId(input.followUpId) } : {}),
        },
        user,
        ctx,
      );
    }
  }
}

// The answers the person can act on get their own reason and buttons on the phone.
function conflictReason(error: AppError): "mobileTaken" | "billTaken" | "alreadyUpdated" | null {
  if (error.message === "customers.errors.mobileTaken" && error.field === "mobile") {
    return "mobileTaken";
  }
  if (error.message === "visits.errors.billTaken") return "billTaken";
  if (error.message === "followUpResult.errors.alreadyUpdated") return "alreadyUpdated";
  return null;
}

export async function runSyncEntries(
  entries: SyncEntry[],
  user: SessionUser,
  device: string | null,
  serverNow = new Date(),
): Promise<EntryResult[]> {
  const results: EntryResult[] = [];
  const activeBranches = new Map<string, boolean>();

  for (const entry of entries) {
    const id = entry.id;
    try {
      // A branch closed since the entry was made takes no new records.
      if (!activeBranches.has(entry.branchId)) {
        const branch = await db.branch.findFirst({
          where: { id: entry.branchId, status: "ACTIVE" },
          select: { id: true },
        });
        activeBranches.set(entry.branchId, branch !== null);
      }
      if (!activeBranches.get(entry.branchId)) {
        throw new AppError("FORBIDDEN", { message: "branch.errors.noAccess" });
      }

      const ctx: WriteContext = {
        branch: entry.branchId,
        device,
        now: entryTime(entry.at, serverNow),
        offline: true,
      };
      const data = await runOne(entry, user, ctx);
      results.push({ id, status: "ok", data });
    } catch (error) {
      if (error instanceof Blocked) {
        results.push({ id, status: "blocked" });
      } else if (error instanceof AppError) {
        if (error.code === "UNAUTHENTICATED") throw error;
        const reason =
          error.message === "sync.conflict.customerChanged"
            ? "customerChanged"
            : conflictReason(error);
        results.push(
          reason
            ? { id, status: "conflict", reason, message: error.message, values: error.values }
            : { id, status: "error", message: error.message, values: error.values },
        );
      } else if (isUniqueViolation(error)) {
        results.push({ id, status: "error", message: "errors.conflict" });
      } else {
        // Unknown: the database was busy, the connection dropped. Keep it and try again.
        logger.error("syncEntry.failed", error, { kind: entry.kind });
        results.push({ id, status: "retry" });
      }
    }
  }
  return results;
}
