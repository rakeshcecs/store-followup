// Writing follow-ups (M07 with a visit; M08 draws its own screen and reuses this; M09
// records what happened on one).
//
// branch-scope-exempt: BR-02 allows one pending follow-up per customer across the whole
// store, and customers are shared (BR-16), so replacing or cancelling "the customer's
// pending follow-up" must look in every branch. New rows are written to the branch
// given by the caller, which comes from writeBranchId().
import { randomUUID } from "node:crypto";
import type { FollowUpMethod, FollowUpResult, Prisma, TimeSlot } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { isoDate } from "@/lib/format";
import { accessScope, branchWhere } from "@/lib/permissions";
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
// need the follow-up was for (BR-05, BR-06). Each one gets its audit row: a status
// change with no entry left the follow-up looking pending forever on the audit screen.
export async function cancelPendingFollowUps(
  tx: Prisma.TransactionClient,
  customerId: string,
  by: { userId: string; device: string | null },
): Promise<number> {
  const pending = await tx.followUp.findMany({
    where: { customerId, status: "PENDING" },
    select: { id: true, branchId: true },
  });
  if (pending.length === 0) return 0;
  const { count } = await tx.followUp.updateMany({
    where: { id: { in: pending.map((row) => row.id) }, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  for (const row of pending) {
    await writeAudit(tx, {
      userId: by.userId,
      branchId: row.branchId,
      action: AUDIT.followUpCancel,
      entityType: "FollowUp",
      entityId: row.id,
      oldValue: { status: "PENDING" },
      newValue: { status: "CANCELLED" },
      device: by.device,
    });
  }
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
  createdFrom: "VISIT" | "FOLLOWUP_RESULT" | "PROFILE" | "OCCASION";
  notReachableCount?: number; // M09.06: "Not reachable" in a row; anything else starts at 0
  enteredOffline?: boolean; // M19: saved on the phone without internet, synced later
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
      notReachableCount: input.notReachableCount ?? 0,
      enteredOffline: input.enteredOffline ?? false,
    },
    select: {
      id: true,
      dueDate: true,
      timeSlot: true,
      method: true,
      reason: true,
      assignedToId: true,
      notReachableCount: true,
    },
  });
  return { followUp, replaced };
}

// The rows that go with every new follow-up, whichever screen set it: the history line
// "Follow-up set for …" (it points at the follow-up, so the profile can show its date),
// and audit rows for the new one and for the one it replaced. Update follow-up (M09)
// writes its own "Follow-up call · …" line instead, so it leaves the history out.
export async function recordFollowUpSet(
  tx: Prisma.TransactionClient,
  input: {
    userId: string | null; // null: the worker set it (M23 occasion follow-ups)
    branchId: string;
    customerId: string;
    device: string | null;
    written: Awaited<ReturnType<typeof writeFollowUp>>;
    history?: boolean;
  },
): Promise<void> {
  const { followUp, replaced } = input.written;
  if (input.history !== false) {
    await writeTimelineEvent(tx, {
      customerId: input.customerId,
      staffId: input.userId,
      branchId: input.branchId,
      kind: "followUpSet",
      detail: followUp.reason ?? undefined,
      entityId: followUp.id,
    });
  }
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

// Who may record what happened on a follow-up (M09), from SOW 3 and 3.1: a salesperson
// the ones assigned to them ("own customers only", and they cannot reassign), a manager
// every one in the branches they work in, an admin all of them. Setting one (M08) stays
// open to everyone ("Add … follow-up: Yes").
//
// A salesperson's own follow-ups count in any branch: customers are shared (BR-16), so a
// visit in the other branch files the next follow-up there while it stays assigned to
// the customer's own salesperson (M08.08) — who must still be able to update it.
export function followUpAccessWhere(user: SessionUser): Prisma.FollowUpWhereInput {
  if (user.role === "SALESPERSON") return { assignedToId: user.id };
  return branchWhere(accessScope(user));
}

export function canUpdateFollowUp(
  user: SessionUser,
  followUp: { assignedToId: string; branchId: string },
): boolean {
  if (user.role === "SALESPERSON") return followUp.assignedToId === user.id;
  const scope = accessScope(user);
  return scope.all || scope.branchIds.includes(followUp.branchId);
}

// M09.10: Done, with the result, the note, when and by whom. Only a PENDING one: of two
// people saving at once, one wins and the other is told it was already updated.
export async function completeFollowUp(
  tx: Prisma.TransactionClient,
  input: { id: string; result: FollowUpResult; note?: string; userId: string; now: Date },
): Promise<void> {
  const { count } = await tx.followUp.updateMany({
    where: { id: input.id, status: "PENDING" },
    data: {
      status: "DONE",
      result: input.result,
      resultNote: input.note ?? null,
      completedAt: input.now,
      completedById: input.userId,
    },
  });
  if (count === 0) {
    throw new AppError("RULE", { message: "followUpResult.errors.alreadyUpdated" });
  }
}

// BR-05: "not interested" closes the enquiry with the reason and cancels what is pending.
// The caller writes its own history line (a visit and a follow-up call read differently).
export async function closeNotInterested(
  tx: Prisma.TransactionClient,
  input: {
    enquiryId: string;
    customerId: string;
    lostReasonId: string;
    userId: string;
    branchId: string;
    device: string | null;
    now: Date;
  },
): Promise<void> {
  await tx.enquiry.update({
    where: { id: input.enquiryId },
    data: { status: "NOT_INTERESTED", lostReasonId: input.lostReasonId, closedAt: input.now },
  });
  await cancelPendingFollowUps(tx, input.customerId, input);
  await writeAudit(tx, {
    userId: input.userId,
    branchId: input.branchId,
    action: AUDIT.enquiryClose,
    entityType: "Enquiry",
    entityId: input.enquiryId,
    newValue: { status: "NOT_INTERESTED", lostReasonId: input.lostReasonId },
    device: input.device,
  });
}

// M09.06: "After 3 not-reachable results in a row, the case is flagged on the manager
// dashboard." Raised once, when the count reaches 3, for the managers of the follow-up's
// branch and every admin. M14's overview and M12's screen read these rows.
export const MISSED_CALLS_ALERT = 3;

export async function notifyManagersOfMissedCalls(
  tx: Prisma.TransactionClient,
  input: { branchId: string; customerId: string; followUpId: string },
): Promise<void> {
  const managers = await tx.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { role: "ADMIN" },
        {
          role: "MANAGER",
          OR: [
            { homeBranchId: input.branchId },
            { extraBranches: { some: { branchId: input.branchId } } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  if (managers.length === 0) return;
  await tx.notification.createMany({
    data: managers.map((manager) => ({
      userId: manager.id,
      type: "followup-missed",
      // The reader's own language is applied when the screen renders it; the row keeps ids.
      message: `followup-missed:${input.customerId}:${input.followUpId}`,
      link: `/customers/${input.customerId}`,
    })),
  });
}
