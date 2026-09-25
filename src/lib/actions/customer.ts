"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { assertDepartmentUsable } from "@/lib/departments";
import { canChangeMobile, canEditCustomer } from "@/lib/customers";
import { AppError } from "@/lib/errors";
import { safeAction } from "@/lib/safe-action";
import { writeTimelineEvent } from "@/lib/timeline";
import { createCustomerInput, updateCustomerInput } from "@/lib/validation/customer";
import { requestWriteContext, isUniqueViolation } from "@/lib/writes/context";
import {
  alreadyExists,
  assertAltMobileFree,
  calendarDate,
  createCustomerCore,
} from "@/lib/writes/customer";

// M05. Every role uses this screen — the SOW's screen list says "Used by: All" — so the
// action checks only that someone is signed in. The work itself is in
// src/lib/writes/customer.ts, shared with the offline sync (M19).

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

export const createCustomer = safeAction({
  name: "createCustomer",
  schema: createCustomerInput,
  auth: {},
  handler: async (input, { user }) =>
    createCustomerCore(input, user, await requestWriteContext(user)),
});

// M06 edit details. Any role may open the profile, but only the assigned salesperson,
// a manager or an admin may change it (M06.07), and only a manager or an admin may
// change the number. History is not editable: this touches the Customer row only.
export const updateCustomer = safeAction({
  name: "updateCustomer",
  schema: updateCustomerInput,
  auth: {},
  handler: async (input, { user }) => {
    // No branch filter: customers are shared across branches (BR-16).
    const current = await db.customer.findFirst({
      where: { id: input.id, active: true },
      select: {
        id: true,
        name: true,
        mobile: true,
        altMobile: true,
        area: true,
        city: true,
        address: true,
        occasion: true,
        occasionDate: true,
        departmentId: true,
        assignedToId: true,
        homeBranchId: true,
      },
    });
    if (!current) throw new AppError("NOT_FOUND");
    if (!canEditCustomer(user, current)) throw new AppError("FORBIDDEN");
    await assertDepartmentUsable(input.departmentId, current.departmentId);

    // An absent number means "unchanged" — a salesperson's form has no box for it.
    const mobile = input.mobile ?? current.mobile;
    if (mobile !== current.mobile && !canChangeMobile(user)) {
      throw new AppError("FORBIDDEN", {
        message: "customers.errors.mobileManagerOnly",
        field: "mobile",
      });
    }

    const next = {
      name: input.name,
      mobile,
      altMobile: input.altMobile ?? null,
      area: input.area ?? null,
      city: input.city ?? null,
      address: input.address ?? null,
      occasion: input.occasion ?? null,
      occasionDate: calendarDate(input.occasionDate),
      departmentId: input.departmentId ?? null,
    };

    // BR-01 for the alternate number. Checked before "did anything change?", so a customer
    // saved earlier with the same number in both boxes cannot be saved again until it is
    // fixed. The schema only sees the mobile the form sent; a salesperson's form sends
    // none, so compare with the stored one here.
    if (next.altMobile && next.altMobile === next.mobile) {
      throw new AppError("VALIDATION", {
        message: "customers.errors.altSameAsMobile",
        field: "altMobile",
      });
    }

    // Only what actually changed goes into the audit row; nothing changed, nothing written.
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (sameValue(current[key], next[key])) continue;
      before[key] = current[key];
      after[key] = next[key];
    }
    if (Object.keys(after).length === 0) return { id: current.id };

    // BR-01: the new number must not belong to anyone else, as main or alternate.
    if ("mobile" in after && mobile) {
      const owner = await db.customer.findFirst({
        where: { id: { not: current.id }, OR: [{ mobile }, { altMobile: mobile }] },
        select: { id: true, name: true },
      });
      if (owner) throw alreadyExists(owner);
    }

    if ("altMobile" in after && next.altMobile) {
      await assertAltMobileFree(next.altMobile, current.id);
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.customer.update({
          where: { id: current.id },
          data: { ...next, updatedById: user.id },
        });

        await writeTimelineEvent(tx, {
          customerId: current.id,
          staffId: user.id,
          kind: "detailsEdited",
        });

        await writeAudit(tx, {
          userId: user.id,
          branchId: current.homeBranchId,
          action: AUDIT.customerUpdate,
          entityType: "Customer",
          entityId: current.id,
          oldValue: before,
          newValue: after,
          device: await device(),
        });
      });
    } catch (error) {
      // The same race as createCustomer: the unique index is the real guard.
      if (isUniqueViolation(error) && mobile) {
        const owner = await db.customer.findUnique({
          where: { mobile },
          select: { id: true, name: true },
        });
        if (owner) throw alreadyExists(owner);
      }
      throw error;
    }

    revalidatePath(`/customers/${current.id}`);
    return { id: current.id };
  },
});

// Dates compare by value; everything else here is a string or null.
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}
