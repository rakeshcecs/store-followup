// Writing follow-ups (M07 with a visit; M08 draws its own screen and reuses this).
//
// branch-scope-exempt: BR-02 allows one pending follow-up per customer across the whole
// store, and customers are shared (BR-16), so replacing or cancelling "the customer's
// pending follow-up" must look in every branch. New rows are written to the branch
// given by the caller, which comes from writeBranchId().
import { randomUUID } from "node:crypto";
import type { FollowUpMethod, Prisma, TimeSlot } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { isoDate } from "@/lib/format";
import { writeTimelineEvent } from "@/lib/timeline";

// BR-08 / M08.05: a follow-up is today or later — today in the shop, i.e. IST.
export function assertDueDate(dueDate: string, now: Date): void {
  if (dueDate < isoDate(now)) {
    throw new AppError("RULE", { message: "visits.errors.dueDatePast", field: "followUp.dueDate" });
  }
}

// "2026-09-24" into a @db.Date column: UTC midnight keeps the calendar day.
export function calendarDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// Cancels whatever is pending for the customer — a sale or "not interested" ends the
// need the follow-up was for (BR-05, BR-06).
export async function cancelPendingFollowUps(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<number> {
  const { count } = await tx.followUp.updateMany({
    where: { customerId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  return count;
}

// The date and slot behind "Follow-up set for …" rows of a customer's history. The history
// shows every branch's events (M06.06, M17), so these are read in every branch too.
export async function followUpDays(
  db: Prisma.TransactionClient,
  ids: string[],
): Promise<Map<string, { dueDate: Date; timeSlot: TimeSlot }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.followUp.findMany({
    where: { id: { in: ids } },
    select: { id: true, dueDate: true, timeSlot: true },
  });
  return new Map(rows.map(({ id, ...day }) => [id, day]));
}

export type NewFollowUp = {
  branchId: string;
  customerId: string;
  enquiryId: string;
  assignedToId: string; // the customer's salesperson by default (M08.08)
  clientId?: string;
  dueDate: string;
  timeSlot: TimeSlot;
  method: FollowUpMethod;
  reason?: string;
  createdFrom: "VISIT" | "FOLLOWUP_RESULT" | "PROFILE";
};

// M08.06: a new follow-up replaces the pending one, which is marked Rescheduled. The old
// row goes first — the pendingCustomerId unique column allows only one PENDING. The
// replaced ids come back so the caller can audit the change of status.
export async function writeFollowUp(tx: Prisma.TransactionClient, input: NewFollowUp) {
  const replaced = await tx.followUp.findMany({
    where: { customerId: input.customerId, status: "PENDING" },
    select: { id: true, branchId: true },
  });
  if (replaced.length > 0) {
    await tx.followUp.updateMany({
      where: { id: { in: replaced.map((row) => row.id) } },
      data: { status: "RESCHEDULED" },
    });
  }

  const followUp = await tx.followUp.create({
    data: {
      branchId: input.branchId,
      customerId: input.customerId,
      enquiryId: input.enquiryId,
      assignedToId: input.assignedToId,
      clientId: input.clientId ?? randomUUID(),
      dueDate: calendarDay(input.dueDate),
      timeSlot: input.timeSlot,
      method: input.method,
      reason: input.reason ?? null,
      createdFrom: input.createdFrom,
    },
    select: {
      id: true,
      dueDate: true,
      timeSlot: true,
      method: true,
      reason: true,
      assignedToId: true,
    },
  });
  return { followUp, replaced };
}

// The rows that go with every new follow-up, whichever screen set it: the history line
// "Follow-up set for …" (it points at the follow-up, so the profile can show its date),
// and audit rows for the new one and for the one it replaced.
export async function recordFollowUpSet(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    branchId: string;
    customerId: string;
    device: string | null;
    written: Awaited<ReturnType<typeof writeFollowUp>>;
  },
): Promise<void> {
  const { followUp, replaced } = input.written;
  await writeTimelineEvent(tx, {
    customerId: input.customerId,
    staffId: input.userId,
    branchId: input.branchId,
    kind: "followUpSet",
    detail: followUp.reason ?? undefined,
    entityId: followUp.id,
  });
  for (const old of replaced) {
    await writeAudit(tx, {
      userId: input.userId,
      branchId: old.branchId,
      action: AUDIT.followUpReschedule,
      entityType: "FollowUp",
      entityId: old.id,
      oldValue: { status: "PENDING" },
      newValue: { status: "RESCHEDULED", replacedBy: followUp.id },
      device: input.device,
    });
  }
  await writeAudit(tx, {
    userId: input.userId,
    branchId: input.branchId,
    action: AUDIT.followUpCreate,
    entityType: "FollowUp",
    entityId: followUp.id,
    newValue: { ...followUp, customerId: input.customerId },
    device: input.device,
  });
}
