// Occasion follow-ups (M23): every day at 6 AM the worker finds the customers whose
// occasion is N days away (Settings → Festivals and occasions, default 30) and sets a call
// follow-up for today — "Occasion on 8 Nov 2026 – check requirement" — so the salesperson
// sees them on Today. Only customers with an open enquiry or none at all (the prompt),
// and never when a follow-up is already pending (BR-02 allows one).
//
// branch-scope-exempt: the worker looks across the whole store; each follow-up is written
// to the customer's home branch, assigned to the customer's own salesperson (M08.08).
import { createTranslator } from "next-intl";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { calendarDay, recordFollowUpSet, writeFollowUp } from "@/lib/follow-ups";
import { formatDate, isoDate, istHour, istMinute } from "@/lib/format";
import type { JobPayloads } from "@/lib/jobs/types";
import { loadMessages } from "@/lib/messages";
import { occasionLeadDays } from "@/lib/settings";

export const OCCASION_JOB_HOUR = 6;
const BATCH = 500;

type Due = {
  type: "occasion-follow-ups";
  payload: JobPayloads["occasion-follow-ups"];
  singletonKey: string;
};

// Due at 06:00 IST, and again on every hour after it as a catch-up for a worker that was
// down at six. The singletonKey per day makes every later enqueue a no-op.
export function dueOccasionJob(now: Date): Due | null {
  const minute = istMinute(now);
  if (istHour(now) < OCCASION_JOB_HOUR || !minute.endsWith(":00")) return null;
  const date = isoDate(now);
  return {
    type: "occasion-follow-ups",
    payload: { date },
    singletonKey: `occasion-follow-ups:${date}`,
  };
}

// Returns how many follow-ups were set. Safe to run twice: the pending check skips the
// customers the first run covered.
export async function createOccasionFollowUps(date: string): Promise<number> {
  const leadDays = await occasionLeadDays();
  const target = addDays(date, leadDays);
  const customers = await db.customer.findMany({
    where: {
      active: true,
      anonymizedAt: null,
      occasionDate: calendarDay(target),
      OR: [{ enquiries: { none: {} } }, { enquiries: { some: { status: "OPEN" } } }],
      followUps: { none: { status: "PENDING" } },
    },
    select: {
      id: true,
      occasion: true,
      occasionDate: true,
      homeBranchId: true,
      assignedToId: true,
      assignedTo: { select: { language: true } },
      enquiries: { where: { status: "OPEN" }, select: { id: true }, take: 1 },
    },
    take: BATCH,
  });

  let written = 0;
  for (const customer of customers) {
    // The salesperson reads the reason on their Today card, so it is in their language.
    const language = customer.assignedTo.language;
    const t = createTranslator({
      locale: language,
      messages: await loadMessages(language),
      namespace: "followUps",
    });
    const reason = t("occasionReason", {
      date: formatDate(customer.occasionDate!, language),
    });
    try {
      await db.$transaction(async (tx) => {
        let enquiryId = customer.enquiries[0]?.id;
        if (!enquiryId) {
          // A follow-up belongs to an enquiry (SOW 5.6); a customer with none (imported,
          // M24) gets one for the occasion.
          const title = customer.occasion?.trim() || t("occasionEnquiryTitle");
          const enquiry = await tx.enquiry.create({
            data: { customerId: customer.id, assignedToId: customer.assignedToId, title },
            select: { id: true },
          });
          enquiryId = enquiry.id;
          await writeAudit(tx, {
            userId: null,
            branchId: customer.homeBranchId,
            action: AUDIT.enquiryCreate,
            entityType: "Enquiry",
            entityId: enquiry.id,
            newValue: { customerId: customer.id, title, createdFrom: "OCCASION" },
          });
        }
        const writtenRow = await writeFollowUp(tx, {
          branchId: customer.homeBranchId,
          customerId: customer.id,
          enquiryId,
          assignedToId: customer.assignedToId,
          dueDate: date,
          timeSlot: "MORNING",
          method: "CALL",
          reason,
          createdFrom: "OCCASION",
        });
        await recordFollowUpSet(tx, {
          userId: null,
          branchId: customer.homeBranchId,
          customerId: customer.id,
          device: null,
          written: writtenRow,
        });
      });
      written += 1;
    } catch (error) {
      // Someone set a follow-up for this customer in the same second: theirs stands.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
        continue;
      throw error;
    }
  }
  return written;
}
