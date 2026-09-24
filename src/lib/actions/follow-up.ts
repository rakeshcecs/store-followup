"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AUDIT, writeAudit } from "@/lib/audit";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays } from "@/lib/follow-up-dates";
import {
  assertDueDate,
  closeNotInterested,
  completeFollowUp,
  followUpAccessWhere,
  MISSED_CALLS_ALERT,
  notifyManagersOfMissedCalls,
  recordFollowUpSet,
  writeFollowUp,
} from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";
import { writeBranchId } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { FOLLOW_UP_CALL_TITLE, writeTimelineEvent } from "@/lib/timeline";
import { recordFollowUpResultInput, setFollowUpInput } from "@/lib/validation/follow-up";

// M08. Setting a follow-up is open to every role (SOW 3.1 "Add … follow-up: Yes"). With a
// visit it goes through recordVisit (BR-04); this is the profile's "Follow-up" (M08.07),
// added to the customer's open enquiry.

// P2002: a unique index said no — this follow-up arrived twice, or someone else set one
// for the same customer at the same moment (pendingCustomerId). P2034: MySQL chose this
// transaction as a deadlock victim in that same race.
const RACE_ATTEMPTS = 3;

function isRace(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error["code"] === "P2002" || error["code"] === "P2034")
  );
}

export const setFollowUp = safeAction({
  name: "setFollowUp",
  schema: setFollowUpInput,
  auth: {},
  handler: async (input, { user }) => {
    // The shop it is set from (BR-16). An admin on "All branches" must pick one.
    const branchId = writeBranchId(user, await getCurrentBranch(user));
    const now = new Date();

    // Sent twice: the same answer, not a second follow-up.
    const saved = async () => {
      const done = await db.followUp.findUnique({
        where: { clientId: input.clientId },
        select: { id: true, customerId: true },
      });
      if (done && done.customerId !== input.customerId) throw new AppError("CONFLICT");
      return done ? { followUpId: done.id } : null;
    };
    const earlier = await saved();
    if (earlier) return earlier;

    // No branch filter: customers are shared across branches (BR-16).
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, active: true },
      select: {
        id: true,
        assignedToId: true,
        enquiries: { where: { status: "OPEN" }, select: { id: true } },
      },
    });
    if (!customer) throw new AppError("NOT_FOUND");
    // A follow-up belongs to an enquiry (SOW 5.6), and an enquiry starts with a visit.
    const enquiry = customer.enquiries[0];
    if (!enquiry) throw new AppError("RULE", { message: "followUps.errors.noOpenEnquiry" });

    assertDueDate(input.followUp.dueDate, now);
    const userDevice = (await headers()).get("user-agent");

    const write = () =>
      db.$transaction(async (tx) => {
        const written = await writeFollowUp(tx, {
          branchId,
          customerId: customer.id,
          enquiryId: enquiry.id,
          assignedToId: customer.assignedToId, // M08.08
          clientId: input.clientId,
          dueDate: input.followUp.dueDate,
          timeSlot: input.followUp.timeSlot,
          method: input.followUp.method,
          reason: input.followUp.reason,
          createdFrom: "PROFILE",
        });
        await recordFollowUpSet(tx, {
          userId: user.id,
          branchId,
          customerId: customer.id,
          device: userDevice,
          written,
        });
        return { followUpId: written.followUp.id };
      });

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await write();
        revalidatePath(`/customers/${customer.id}`);
        return result;
      } catch (error) {
        if (!isRace(error) || attempt === RACE_ATTEMPTS) throw error;
        // This very request, saved by its twin a moment ago…
        const twin = await saved();
        if (twin) return twin;
        // …or another follow-up for the customer won the race. Setting a new one
        // replaces the pending one (M08.06), so try again: this one replaces that one.
      }
    }
  },
});

// M09: what happened on a follow-up. It is marked Done with the result (M09.10) and,
// for "will visit", "call later" and "not reachable", the next one is set in the same
// transaction; "not interested" closes the enquiry (BR-05). The next follow-up stays in
// the old one's branch and with the same person — it is the same case, carried on.
export const recordFollowUpResult = safeAction({
  name: "recordFollowUpResult",
  schema: recordFollowUpResultInput,
  auth: {},
  handler: async (input, { user }) => {
    const now = new Date();
    const followUp = await db.followUp.findFirst({
      where: { id: input.id, ...followUpAccessWhere(user) },
      select: {
        id: true,
        branchId: true,
        customerId: true,
        enquiryId: true,
        assignedToId: true,
        timeSlot: true,
        method: true,
        status: true,
        notReachableCount: true,
      },
    });
    if (!followUp) throw new AppError("NOT_FOUND");

    // Sent twice — a retry, a double tap: the same answer, not a second result.
    const same = async () => {
      const row = await db.followUp.findUnique({
        where: { id: followUp.id },
        select: { status: true, result: true, completedById: true },
      });
      if (row?.status !== "DONE" || row.result !== input.result || row.completedById !== user.id) {
        return null;
      }
      const next = await db.followUp.findUnique({
        where: { clientId: input.clientId },
        select: { id: true },
      });
      return { followUpId: followUp.id, nextFollowUpId: next?.id ?? null };
    };
    if (followUp.status !== "PENDING") {
      const earlier = await same();
      if (earlier) return earlier;
      throw new AppError("RULE", { message: "followUpResult.errors.alreadyUpdated" });
    }

    // M09.04–06: the day of the next follow-up. "Not reachable" is always tomorrow.
    const nextDate =
      input.result === "WILL_VISIT" || input.result === "CALL_LATER"
        ? input.nextDate
        : input.result === "NOT_REACHABLE"
          ? addDays(isoDate(now), 1)
          : null;
    if (nextDate) assertDueDate(nextDate, now);

    const reason =
      input.result === "NOT_INTERESTED"
        ? await db.lostReason.findFirst({
            where: { id: input.lostReasonId, active: true },
            select: { id: true, nameEn: true },
          })
        : null;
    if (input.result === "NOT_INTERESTED" && !reason) {
      throw new AppError("NOT_FOUND", {
        message: "visits.errors.reasonUnknown",
        field: "lostReasonId",
      });
    }

    const userDevice = (await headers()).get("user-agent");
    const missed = input.result === "NOT_REACHABLE" ? followUp.notReachableCount + 1 : 0;

    try {
      const saved = await db.$transaction(async (tx) => {
        await completeFollowUp(tx, {
          id: followUp.id,
          result: input.result,
          note: input.note,
          userId: user.id,
          now,
        });
        await writeAudit(tx, {
          userId: user.id,
          branchId: followUp.branchId,
          action: AUDIT.followUpResult,
          entityType: "FollowUp",
          entityId: followUp.id,
          oldValue: { status: "PENDING" },
          newValue: { status: "DONE", result: input.result, note: input.note ?? null },
          device: userDevice,
        });

        let nextId: string | null = null;
        if (nextDate) {
          const written = await writeFollowUp(tx, {
            branchId: followUp.branchId,
            customerId: followUp.customerId,
            enquiryId: followUp.enquiryId,
            assignedToId: followUp.assignedToId,
            clientId: input.clientId,
            dueDate: nextDate,
            // M09.04: "method VISIT, same slot"; M09.05: method CALL; "not reachable"
            // tries again the same way.
            timeSlot: followUp.timeSlot,
            method:
              input.result === "WILL_VISIT"
                ? "VISIT"
                : input.result === "CALL_LATER"
                  ? "CALL"
                  : followUp.method,
            createdFrom: "FOLLOWUP_RESULT",
            notReachableCount: missed,
          });
          await recordFollowUpSet(tx, {
            userId: user.id,
            branchId: followUp.branchId,
            customerId: followUp.customerId,
            device: userDevice,
            written,
            history: false,
          });
          nextId = written.followUp.id;
          if (missed === MISSED_CALLS_ALERT) {
            await notifyManagersOfMissedCalls(tx, {
              branchId: followUp.branchId,
              customerId: followUp.customerId,
              followUpId: nextId,
            });
          }
        }

        if (reason) {
          await closeNotInterested(tx, {
            enquiryId: followUp.enquiryId,
            customerId: followUp.customerId,
            lostReasonId: reason.id,
            userId: user.id,
            branchId: followUp.branchId,
            device: userDevice,
            now,
          });
        }

        await writeTimelineEvent(tx, {
          customerId: followUp.customerId,
          staffId: user.id,
          branchId: followUp.branchId,
          kind: "followUpResult",
          title: FOLLOW_UP_CALL_TITLE[input.result],
          detail: [reason?.nameEn, input.note].filter(Boolean).join(" · ") || undefined,
          entityId: nextId ?? followUp.id,
        });

        return { followUpId: followUp.id, nextFollowUpId: nextId };
      });

      revalidatePath(`/customers/${followUp.customerId}`);
      return saved;
    } catch (error) {
      // Someone saved a result a moment ago: if it was this very request, the same answer.
      if (error instanceof AppError || isRace(error)) {
        const earlier = await same();
        if (earlier) return earlier;
      }
      throw error;
    }
  },
});
