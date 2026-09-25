// M16.03 privacy delete (DPDP Act 2023): an admin removes a customer's personal details
// on the customer's request. The customer row stays, anonymised, so their visits, sales
// and follow-ups still count in every report — only who they were is gone.
//
// branch-scope-exempt: a privacy delete covers the customer everywhere; customers are
// shared across branches (BR-16), so every branch's rows about them are cleared.
import { Prisma } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";

// What the customer's name becomes. Stored data, not UI text: reports show it as is.
export const DELETED_NAME = "Deleted";

// Fields in audit values that describe the person: cleared in the customer's past audit
// rows too, or the log would keep what the customer asked us to remove.
const PERSONAL_KEYS = new Set([
  "name",
  "mobile",
  "altMobile",
  "address",
  "area",
  "city",
  "occasion",
  "occasionDate",
  "remarks",
  "latestRemarks",
  "resultNote",
  "note",
  "reason",
]);

function scrub(value: Prisma.JsonValue | null): Prisma.InputJsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  let changed = false;
  const out: Record<string, Prisma.JsonValue> = {};
  for (const [key, field] of Object.entries(value)) {
    if (PERSONAL_KEYS.has(key) && field !== null && field !== undefined) {
      out[key] = key === "name" ? DELETED_NAME : null;
      changed = true;
    } else {
      out[key] = field ?? null;
    }
  }
  return changed ? (out as Prisma.InputJsonValue) : undefined;
}

export type AnonymizeResult = { followUpsCancelled: number; auditRowsCleared: number };

// One transaction. The last four digits have already been checked by the caller.
export async function anonymizeCustomer(
  tx: Prisma.TransactionClient,
  input: {
    actor: { id: string };
    customer: { id: string; homeBranchId: string };
    device: string | null;
    now?: Date;
  },
): Promise<AnonymizeResult> {
  const now = input.now ?? new Date();
  const { customer } = input;
  const where = { customerId: customer.id };
  const before = await tx.customer.findUniqueOrThrow({
    where: { id: customer.id },
    select: { mobile: true, altMobile: true },
  });
  const numbers = [before.mobile, before.altMobile].filter((n): n is string => Boolean(n));

  await tx.customer.update({
    where: { id: customer.id },
    data: {
      name: DELETED_NAME,
      // Null, not "Deleted": the number is unique (decisions.md, model fixes).
      mobile: null,
      altMobile: null,
      address: null,
      area: null,
      city: null,
      occasion: null,
      occasionDate: null,
      preferredLanguage: null,
      active: false,
      anonymizedAt: now,
      updatedById: input.actor.id,
    },
  });

  // Free-text remarks can hold anything the customer said about themselves.
  await tx.visit.updateMany({ where, data: { remarks: null } });
  await tx.enquiry.updateMany({ where, data: { latestRemarks: null } });
  await tx.sale.updateMany({ where, data: { remarks: null } });
  await tx.followUp.updateMany({ where, data: { resultNote: null, reason: null } });
  await tx.timelineEvent.updateMany({ where, data: { detail: null } });
  await scrubImportFiles(tx, numbers);
  // Nobody may call them again about this: their open follow-up goes.
  const cancelled = await tx.followUp.updateMany({
    where: { ...where, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  // Their past audit rows keep what happened and who did it, not who the customer was.
  const [enquiries, visits, followUps, sales] = await Promise.all([
    tx.enquiry.findMany({ where, select: { id: true } }),
    tx.visit.findMany({ where, select: { id: true } }),
    tx.followUp.findMany({ where, select: { id: true } }),
    tx.sale.findMany({ where, select: { id: true } }),
  ]);
  const entityIds = [customer.id, ...[enquiries, visits, followUps, sales].flat().map((r) => r.id)];
  const rows = await tx.auditLog.findMany({
    where: { entityId: { in: entityIds } },
    select: { id: true, oldValue: true, newValue: true },
  });
  let cleared = 0;
  for (const row of rows) {
    const oldValue = scrub(row.oldValue);
    const newValue = scrub(row.newValue);
    if (!oldValue && !newValue) continue;
    await tx.auditLog.update({
      where: { id: row.id },
      data: { ...(oldValue ? { oldValue } : {}), ...(newValue ? { newValue } : {}) },
    });
    cleared += 1;
  }

  // Who did it and when (module prompt) — and nothing about the person.
  await writeAudit(tx, {
    userId: input.actor.id,
    branchId: customer.homeBranchId,
    action: AUDIT.customerAnonymize,
    entityType: "Customer",
    entityId: customer.id,
    newValue: { anonymizedAt: now, followUpsCancelled: cancelled.count },
    device: input.device,
  });

  return { followUpsCancelled: cancelled.count, auditRowsCleared: cleared };
}

// M24: an import keeps the file's rows until it is started or thrown away, and the rows it
// did not simply import (for the result file) for good. Their line in either goes.
async function scrubImportFiles(tx: Prisma.TransactionClient, numbers: string[]) {
  if (numbers.length === 0) return;
  const mine = (row: Prisma.JsonObject) =>
    numbers.includes(String(row.mobile)) || numbers.includes(String(row.altMobile));
  const clean = (list: Prisma.JsonValue | null) => {
    if (!Array.isArray(list)) return undefined;
    let changed = false;
    const out = list.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || !mine(item)) return item;
      changed = true;
      const scrubbed: Prisma.JsonObject = { ...item, name: DELETED_NAME, mobile: "" };
      for (const key of ["altMobile", "area", "city", "occasion", "occasionDate"]) {
        if (key in item) scrubbed[key] = null;
      }
      return scrubbed;
    });
    return changed ? (out as Prisma.InputJsonValue) : undefined;
  };
  const jobs = await tx.importJob.findMany({ select: { id: true, rows: true, outcomes: true } });
  for (const job of jobs) {
    const rows = clean(job.rows);
    const outcomes = clean(job.outcomes);
    if (!rows && !outcomes) continue;
    await tx.importJob.update({
      where: { id: job.id },
      data: { ...(rows ? { rows } : {}), ...(outcomes ? { outcomes } : {}) },
    });
  }
}

// "Type the last 4 digits of the mobile" (module prompt): a deliberate act, not a slip.
export function lastFourMatch(mobile: string | null, typed: string): boolean {
  return mobile !== null && /^\d{4}$/.test(typed) && mobile.endsWith(typed);
}
