"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { Role } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { calendarDay } from "@/lib/follow-ups";
import { accessScope, branchWhere, writeBranchId } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import {
  assertBillAmount,
  assertBillDate,
  assertBillFree,
  billOwner,
  billTakenError,
} from "@/lib/sales";
import { billAmountRequired } from "@/lib/settings";
import { staffBranchWhere } from "@/lib/staff-scope";
import { writeTimelineEvent } from "@/lib/timeline";
import { formatDate } from "@/lib/format";
import {
  cancelSaleInput,
  checkBillInput,
  recordSaleInput,
  updateSaleInput,
} from "@/lib/validation/sale";
import { requestWriteContext } from "@/lib/writes/context";
import { recordSaleCore } from "@/lib/writes/sale";

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

// The work is in src/lib/writes/sale.ts, shared with the offline sync (M19).
export const recordSale = safeAction({
  name: "recordSale",
  schema: recordSaleInput,
  auth: {},
  handler: async (input, { user }) => recordSaleCore(input, user, await requestWriteContext(user)),
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
        // Not cancelled, checked in the write: a manager cancelling at the same moment
        // would otherwise have this edit land on a cancelled sale.
        const { count } = await tx.sale.updateMany({
          where: { id: sale.id, cancelled: false },
          data: next,
        });
        if (count === 0) throw new AppError("RULE", { message: "sales.errors.cancelled" });
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
    const done = await db.$transaction(async (tx) => {
      // Two managers pressing at once: one cancels, the other finds it done — not a second
      // reason written over the first, with two history and audit rows.
      const { count } = await tx.sale.updateMany({
        where: { id: sale.id, cancelled: false },
        data: {
          cancelled: true,
          cancelReason: input.reason,
          cancelledById: user.id,
          cancelledAt: now,
        },
      });
      if (count === 0) return false;
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
      return true;
    });
    if (!done) return { id: sale.id };

    revalidatePath(`/sales/${sale.id}`);
    revalidatePath(`/customers/${sale.customerId}`);
    return { id: sale.id };
  },
});
