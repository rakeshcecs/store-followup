"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { Role } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { calendarDay, completeFollowUp, followUpAccessWhere } from "@/lib/follow-ups";
import { accessScope, branchWhere, writeBranchId } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import {
  assertBillAmount,
  assertBillDate,
  assertBillFree,
  billOwner,
  billTakenError,
  writeSale,
} from "@/lib/sales";
import { billAmountRequired } from "@/lib/settings";
import { staffBranchWhere } from "@/lib/staff-scope";
import { FOLLOW_UP_CALL_TITLE, writeTimelineEvent } from "@/lib/timeline";
import { formatDate } from "@/lib/format";
import {
  cancelSaleInput,
  checkBillInput,
  recordSaleInput,
  updateSaleInput,
} from "@/lib/validation/sale";

// M10. Recording a sale is open to every role (SOW 3.1 "Add … sale: Yes"); changing or
// cancelling a saved one is for a manager or an admin, with a reason (M10.09).

const MANAGERS: { roles: Role[] } = { roles: ["MANAGER", "ADMIN"] };

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error["code"] === "P2002"
  );
}

// The live duplicate check while the bill number is typed (M10.02, M10.03), against the
// branch on screen — the one the sale would be saved to.
export const checkBill = safeAction({
  name: "checkBill",
  schema: checkBillInput,
  auth: {},
  handler: async (input, { user }) => {
    const branchId = writeBranchId(user, await getCurrentBranch(user));
    const owner = await billOwner(branchId, input.billNumber);
    return owner
      ? {
          free: false as const,
          name: owner.customer.name,
          date: formatDate(owner.billDate, user.language),
        }
      : { free: true as const };
  },
});

// A sale on its own — "Sale done" on the profile — added to the customer's open enquiry.
// With no open enquiry the purchase is a visit, recorded through Record visit (BR-03).
// From Update follow-up's "Customer already bought" (M09.07) it also names the follow-up:
// that one is marked Done only now, with the sale, and becomes its linked follow-up.
export const recordSale = safeAction({
  name: "recordSale",
  schema: recordSaleInput,
  auth: {},
  handler: async (input, { user }) => {
    const branchId = writeBranchId(user, await getCurrentBranch(user));
    const now = new Date();

    // Sent twice: the same answer, not a second sale.
    const done = await db.sale.findUnique({
      where: { clientId: input.clientId },
      select: { id: true, customerId: true, billNumber: true },
    });
    if (done) {
      if (done.customerId !== input.customerId) throw new AppError("CONFLICT");
      return { saleId: done.id, billNumber: done.billNumber };
    }

    // No branch filter: customers are shared across branches (BR-16).
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, active: true },
      select: { id: true, enquiries: { where: { status: "OPEN" }, select: { id: true } } },
    });
    if (!customer) throw new AppError("NOT_FOUND");
    const enquiry = customer.enquiries[0];
    if (!enquiry) throw new AppError("RULE", { message: "sales.errors.noOpenEnquiry" });

    // The same rule as Update follow-up: the person who may record its result (M09).
    const followUp = input.followUpId
      ? await db.followUp.findFirst({
          where: { id: input.followUpId, customerId: customer.id, ...followUpAccessWhere(user) },
          select: { id: true, branchId: true, status: true },
        })
      : null;
    if (input.followUpId && !followUp) throw new AppError("NOT_FOUND");
    if (followUp && followUp.status !== "PENDING") {
      throw new AppError("RULE", { message: "followUpResult.errors.alreadyUpdated" });
    }

    assertBillDate(input.sale.billDate, now);
    assertBillAmount(input.sale.billAmount, await billAmountRequired());
    await assertBillFree(branchId, input.sale.billNumber, user.language);
    const userDevice = await device();

    try {
      const sale = await db.$transaction(async (tx) => {
        // Done before the sale is written, so writeSale links it as "the last completed
        // follow-up of the enquiry" (SOW 5.7) and the sale counts as a conversion (BR-11).
        if (followUp) {
          await completeFollowUp(tx, {
            id: followUp.id,
            result: "ALREADY_BOUGHT",
            note: input.followUpNote,
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
            newValue: {
              status: "DONE",
              result: "ALREADY_BOUGHT",
              note: input.followUpNote ?? null,
            },
            device: userDevice,
          });
          await writeTimelineEvent(tx, {
            customerId: customer.id,
            staffId: user.id,
            branchId: followUp.branchId,
            kind: "followUpResult",
            title: FOLLOW_UP_CALL_TITLE.ALREADY_BOUGHT,
            detail: input.followUpNote,
            entityId: followUp.id,
          });
        }
        const created = await writeSale(tx, {
          branchId,
          customerId: customer.id,
          enquiryId: enquiry.id,
          salespersonId: user.id,
          clientId: input.clientId,
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
          detail: created.billNumber,
          entityId: created.id,
        });
        await writeAudit(tx, {
          userId: user.id,
          branchId,
          action: AUDIT.saleCreate,
          entityType: "Sale",
          entityId: created.id,
          newValue: created,
          device: userDevice,
        });
        return created;
      });

      revalidatePath(`/customers/${customer.id}`);
      return { saleId: sale.id, billNumber: sale.billNumber };
    } catch (error) {
      // Two people saving the same bill at the same moment: the unique index lets one
      // through, and the other gets the message the check above would have given.
      if (isUniqueViolation(error)) {
        throw await billTakenError(branchId, input.sale.billNumber, user.language);
      }
      throw error;
    }
  },
});

// A saved sale in any branch the manager works in, whichever one the switcher shows; a
// branch they do not work in is simply not found (M17).
async function saleInScope(id: string, user: SessionUser) {
  const sale = await db.sale.findFirst({
    where: { id, ...branchWhere(accessScope(user)) },
    select: {
      id: true,
      branchId: true,
      customerId: true,
      billNumber: true,
      billDate: true,
      billAmount: true,
      salespersonId: true,
      cancelled: true,
    },
  });
  if (!sale) throw new AppError("NOT_FOUND");
  return sale;
}

export const updateSale = safeAction({
  name: "updateSale",
  schema: updateSaleInput,
  auth: MANAGERS,
  handler: async (input, { user }) => {
    const sale = await saleInScope(input.id, user);
    if (sale.cancelled) throw new AppError("RULE", { message: "sales.errors.cancelled" });

    assertBillDate(input.billDate, new Date());
    assertBillAmount(input.billAmount, await billAmountRequired());

    // The credit goes to someone who works in the sale's branch.
    const salesperson = await db.user.findFirst({
      where: {
        id: input.salespersonId,
        status: "ACTIVE",
        ...staffBranchWhere({ all: false, branchIds: [sale.branchId] }),
      },
      select: { id: true },
    });
    if (!salesperson) {
      throw new AppError("NOT_FOUND", {
        message: "sales.errors.salespersonUnknown",
        field: "salespersonId",
      });
    }

    if (input.billNumber !== sale.billNumber) {
      await assertBillFree(sale.branchId, input.billNumber, user.language);
    }

    const next = {
      billNumber: input.billNumber,
      billDate: calendarDay(input.billDate),
      billAmount: input.billAmount ?? null,
      salespersonId: input.salespersonId,
    };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      const old = sale[key];
      const now = next[key];
      const same =
        old instanceof Date && now instanceof Date
          ? old.getTime() === now.getTime()
          : String(old ?? "") === String(now ?? "");
      if (same) continue;
      before[key] = old;
      after[key] = now;
    }
    if (Object.keys(after).length === 0) return { id: sale.id };

    const userDevice = await device();
    try {
      await db.$transaction(async (tx) => {
        await tx.sale.update({ where: { id: sale.id }, data: next });
        await writeTimelineEvent(tx, {
          customerId: sale.customerId,
          staffId: user.id,
          branchId: sale.branchId,
          kind: "saleEdited",
          detail: input.reason,
          entityId: sale.id,
        });
        await writeAudit(tx, {
          userId: user.id,
          branchId: sale.branchId,
          action: AUDIT.saleUpdate,
          entityType: "Sale",
          entityId: sale.id,
          oldValue: before,
          newValue: { ...after, reason: input.reason },
          device: userDevice,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw await billTakenError(sale.branchId, input.billNumber, user.language);
      }
      throw error;
    }

    revalidatePath(`/sales/${sale.id}`);
    revalidatePath(`/customers/${sale.customerId}`);
    return { id: sale.id };
  },
});

// Cancelled, never deleted (BR-14): the row and its bill number stay, so the number
// cannot be reused in the branch and the history still shows what happened. The
// enquiry is left as it is — the SOW says nothing about reopening it.
export const cancelSale = safeAction({
  name: "cancelSale",
  schema: cancelSaleInput,
  auth: MANAGERS,
  handler: async (input, { user }) => {
    const sale = await saleInScope(input.id, user);
    if (sale.cancelled) return { id: sale.id };

    const now = new Date();
    const userDevice = await device();
    await db.$transaction(async (tx) => {
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          cancelled: true,
          cancelReason: input.reason,
          cancelledById: user.id,
          cancelledAt: now,
        },
      });
      await writeTimelineEvent(tx, {
        customerId: sale.customerId,
        staffId: user.id,
        branchId: sale.branchId,
        kind: "saleCancelled",
        detail: input.reason,
        entityId: sale.id,
      });
      await writeAudit(tx, {
        userId: user.id,
        branchId: sale.branchId,
        action: AUDIT.saleCancel,
        entityType: "Sale",
        entityId: sale.id,
        oldValue: { cancelled: false },
        newValue: { cancelled: true, reason: input.reason },
        device: userDevice,
      });
    });

    revalidatePath(`/sales/${sale.id}`);
    revalidatePath(`/customers/${sale.customerId}`);
    return { id: sale.id };
  },
});
