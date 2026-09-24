"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AUDIT, writeAudit } from "@/lib/audit";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  assertDueDate,
  cancelPendingFollowUps,
  recordFollowUpSet,
  writeFollowUp,
} from "@/lib/follow-ups";
import { branchWhereShared, writeBranchId } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import {
  assertBillAmount,
  assertBillDate,
  assertBillFree,
  billTakenError,
  writeSale,
} from "@/lib/sales";
import { billAmountRequired } from "@/lib/settings";
import { writeTimelineEvent } from "@/lib/timeline";
import { recordVisitInput } from "@/lib/validation/visit";
import { enquiryTitle, visitTypeFor } from "@/lib/visits";

// M07. Every role records visits (SOW 3.1 "Add customer, visit, follow-up, sale: Yes"),
// so the action checks only that someone is signed in. Everything below happens in one
// transaction: a visit never exists without its sale, its follow-up or its reason
// (BR-03, BR-04, BR-05).

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error["code"] === "P2002"
  );
}

export const recordVisit = safeAction({
  name: "recordVisit",
  schema: recordVisitInput,
  auth: {},
  handler: async (input, { user }) => {
    // The shop the visit happened in (M17.04). An admin on "All branches" must pick one.
    const branchId = writeBranchId(user, await getCurrentBranch(user));
    const now = new Date();

    // Sent twice — a retry, a double tap, an offline sync — and already saved: the same
    // answer again, not a second visit.
    const done = await db.visit.findUnique({
      where: { clientId: input.clientId },
      select: { id: true, customerId: true },
    });
    if (done) {
      if (done.customerId !== input.customerId) throw new AppError("CONFLICT");
      return { visitId: done.id, customerId: done.customerId };
    }

    // No branch filter: customers are shared across branches (BR-16).
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, active: true },
      select: { id: true, assignedToId: true, firstVisitAt: true },
    });
    if (!customer) throw new AppError("NOT_FOUND");

    // Only categories this branch offers (shared ones, or its own — M17.07).
    const categories = await db.requirementCategory.findMany({
      where: {
        id: { in: input.categoryIds },
        active: true,
        ...branchWhereShared({ all: false, branchIds: [branchId] }),
      },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: { id: true, nameEn: true },
    });
    if (categories.length !== new Set(input.categoryIds).size) {
      throw new AppError("NOT_FOUND", {
        message: "visits.errors.categoryUnknown",
        field: "categoryIds",
      });
    }

    const reason =
      input.outcome === "NOT_INTERESTED"
        ? await db.lostReason.findFirst({
            where: { id: input.lostReasonId, active: true },
            select: { id: true, nameEn: true },
          })
        : null;
    if (input.outcome === "NOT_INTERESTED" && !reason) {
      throw new AppError("NOT_FOUND", {
        message: "visits.errors.reasonUnknown",
        field: "lostReasonId",
      });
    }

    // BR-07, BR-08, checked before anything is written so the message is the right one.
    if (input.outcome === "PURCHASED") {
      assertBillDate(input.sale.billDate, now);
      assertBillAmount(input.sale.billAmount, await billAmountRequired());
      await assertBillFree(branchId, input.sale.billNumber, user.language);
    }
    if (input.outcome === "DECIDE_LATER") assertDueDate(input.followUp.dueDate, now);

    const userDevice = await device();

    try {
      const saved = await db.$transaction(async (tx) => {
        // M07.09 / BR-02: join the open enquiry, or open one. The generated
        // openCustomerId column allows only one OPEN enquiry per customer.
        const open = await tx.enquiry.findFirst({
          where: { customerId: customer.id, status: "OPEN" },
          select: { id: true },
        });
        const enquiry = open
          ? await tx.enquiry.update({
              where: { id: open.id },
              data: {
                ...(input.expectedPurchase ? { expectedPurchase: input.expectedPurchase } : {}),
                ...(input.remarks ? { latestRemarks: input.remarks } : {}),
              },
              select: { id: true },
            })
          : await tx.enquiry.create({
              data: {
                customerId: customer.id,
                title: enquiryTitle(categories.map((category) => category.nameEn)),
                expectedPurchase: input.expectedPurchase ?? null,
                latestRemarks: input.remarks ?? null,
                assignedToId: customer.assignedToId,
              },
              select: { id: true },
            });
        // Categories add up over the enquiry's visits; none is taken away.
        await tx.enquiryCategory.createMany({
          data: categories.map((category) => ({ enquiryId: enquiry.id, categoryId: category.id })),
          skipDuplicates: true,
        });

        const visit = await tx.visit.create({
          data: {
            branchId,
            customerId: customer.id,
            enquiryId: enquiry.id,
            clientId: input.clientId,
            visitAt: now,
            salespersonId: user.id, // SOW 5.5 "Default logged-in user"
            remarks: input.remarks ?? null,
            outcome: input.outcome,
            lostReasonId: reason?.id ?? null,
            visitType: visitTypeFor(customer.firstVisitAt, now),
            categories: {
              create: categories.map((category) => ({ categoryId: category.id })),
            },
          },
          select: { id: true, visitType: true, outcome: true },
        });
        if (customer.firstVisitAt === null) {
          await tx.customer.update({ where: { id: customer.id }, data: { firstVisitAt: now } });
        }

        await writeTimelineEvent(tx, {
          customerId: customer.id,
          staffId: user.id,
          branchId,
          kind: "visit",
          detail: input.remarks,
        });
        await writeAudit(tx, {
          userId: user.id,
          branchId,
          action: AUDIT.visitCreate,
          entityType: "Visit",
          entityId: visit.id,
          newValue: { ...visit, enquiryId: enquiry.id, customerId: customer.id },
          device: userDevice,
        });

        if (input.outcome === "PURCHASED") {
          const sale = await writeSale(tx, {
            branchId,
            customerId: customer.id,
            enquiryId: enquiry.id,
            salespersonId: user.id,
            clientId: input.sale.clientId,
            billNumber: input.sale.billNumber,
            billDate: input.sale.billDate,
            billAmount: input.sale.billAmount,
            remarks: input.sale.remarks,
          });
          await writeTimelineEvent(tx, {
            customerId: customer.id,
            staffId: user.id,
            branchId,
            kind: "saleCompleted",
            detail: sale.billNumber,
            entityId: sale.id,
          });
          await writeAudit(tx, {
            userId: user.id,
            branchId,
            action: AUDIT.saleCreate,
            entityType: "Sale",
            entityId: sale.id,
            newValue: sale,
            device: userDevice,
          });
        }

        if (input.outcome === "DECIDE_LATER") {
          const written = await writeFollowUp(tx, {
            branchId,
            customerId: customer.id,
            enquiryId: enquiry.id,
            assignedToId: customer.assignedToId,
            clientId: input.followUp.clientId,
            dueDate: input.followUp.dueDate,
            timeSlot: input.followUp.timeSlot,
            method: input.followUp.method,
            reason: input.followUp.reason,
            createdFrom: "VISIT",
          });
          await recordFollowUpSet(tx, {
            userId: user.id,
            branchId,
            customerId: customer.id,
            device: userDevice,
            written,
          });
        }

        if (input.outcome === "NOT_INTERESTED" && reason) {
          // BR-05: the enquiry closes with the reason, and nothing stays pending.
          await tx.enquiry.update({
            where: { id: enquiry.id },
            data: { status: "NOT_INTERESTED", lostReasonId: reason.id, closedAt: now },
          });
          await cancelPendingFollowUps(tx, customer.id);
          await writeTimelineEvent(tx, {
            customerId: customer.id,
            staffId: user.id,
            branchId,
            kind: "notInterested",
            detail: reason.nameEn,
          });
          await writeAudit(tx, {
            userId: user.id,
            branchId,
            action: AUDIT.enquiryClose,
            entityType: "Enquiry",
            entityId: enquiry.id,
            newValue: { status: "NOT_INTERESTED", lostReasonId: reason.id },
            device: userDevice,
          });
        }

        return { visitId: visit.id, customerId: customer.id };
      });

      revalidatePath(`/customers/${customer.id}`);
      return saved;
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Someone else saved the same bill number in this branch a moment ago (BR-07)…
        if (input.outcome === "PURCHASED") {
          const taken = await billTakenError(branchId, input.sale.billNumber, user.language);
          if (taken.message !== "errors.conflict") throw taken;
        }
        // …or this very visit arrived twice at once.
        const twin = await db.visit.findUnique({
          where: { clientId: input.clientId },
          select: { id: true, customerId: true },
        });
        if (twin?.customerId === customer.id) {
          return { visitId: twin.id, customerId: twin.customerId };
        }
      }
      throw error;
    }
  },
});
