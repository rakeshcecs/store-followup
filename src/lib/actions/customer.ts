"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { AUDIT, writeAudit } from "@/lib/audit";
import { getBranchScope, getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { canChangeMobile, canEditCustomer } from "@/lib/customers";
import { AppError } from "@/lib/errors";
import { writeBranchId } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { staffBranchWhere } from "@/lib/staff-scope";
import { writeTimelineEvent } from "@/lib/timeline";
import { createCustomerInput, updateCustomerInput } from "@/lib/validation/customer";

// M05. Every role uses this screen — the SOW's screen list says "Used by: All" — so the
// action checks only that someone is signed in.

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

// "2026-09-23" into a @db.Date column. UTC midnight keeps the day the day: local
// midnight would shift back one day in IST.
function calendarDate(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

// Thrown when the number is already taken (BR-01, M05.09). The form answers it by
// sending the person to the search screen for that number, where they get the existing
// customer's card — the SOW asks for the customer, not for an error nobody can act on.
function alreadyExists(customer: { name: string }): AppError {
  return new AppError("CONFLICT", {
    message: "customers.errors.mobileTaken",
    field: "mobile",
    values: { name: customer.name },
  });
}

export const createCustomer = safeAction({
  name: "createCustomer",
  schema: createCustomerInput,
  auth: {},
  handler: async (input, { user }) => {
    // The branch the customer is first recorded in. Customers are shared across
    // branches (BR-16); this only says where they walked in.
    const homeBranchId = writeBranchId(user, await getCurrentBranch(user));

    // "Handled by" only offers people from the branch on screen, but the id arrives in a
    // form post and nothing stopped one from another branch — which would leave a
    // customer in branch A looked after by someone who does not work there.
    const scope = await getBranchScope(user);
    const assignee = await db.user.findFirst({
      where: { id: input.assignedToId, status: "ACTIVE", ...staffBranchWhere(scope) },
      select: { id: true },
    });
    if (!assignee) {
      throw new AppError("NOT_FOUND", {
        message: "customers.errors.assigneeUnknown",
        field: "assignedToId",
      });
    }

    // Checked before the insert so the common case gets the good message, and again by
    // the unique index below so two people saving at the same instant cannot both win.
    const existing = await db.customer.findFirst({
      where: { OR: [{ mobile: input.mobile }, { altMobile: input.mobile }] },
      select: { id: true, name: true },
    });
    if (existing) throw alreadyExists(existing);
    if (input.altMobile) await assertAltMobileFree(input.altMobile);

    const now = new Date();

    try {
      const created = await db.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            name: input.name,
            mobile: input.mobile,
            altMobile: input.altMobile ?? null,
            area: input.area ?? null,
            city: input.city ?? null,
            address: input.address ?? null,
            occasion: input.occasion ?? null,
            occasionDate: calendarDate(input.occasionDate),
            departmentId: input.departmentId ?? null,
            assignedToId: input.assignedToId,
            homeBranchId,
            source: "WALK_IN",
            consentGiven: input.consentGiven,
            // Who took the consent and when, not just that it was given (M05.08).
            consentAt: input.consentGiven ? now : null,
            consentById: input.consentGiven ? user.id : null,
            createdById: user.id,
            updatedById: user.id,
          },
          select: { id: true, name: true, mobile: true },
        });

        await writeTimelineEvent(tx, {
          customerId: customer.id,
          staffId: user.id,
          kind: "customerAdded",
        });

        await writeAudit(tx, {
          userId: user.id,
          branchId: homeBranchId,
          action: AUDIT.customerCreate,
          entityType: "Customer",
          entityId: customer.id,
          newValue: customer,
          device: await device(),
        });

        return { id: customer.id, name: customer.name };
      });

      revalidatePath("/customers");
      return created;
    } catch (error) {
      // The race: someone else inserted the same number between the check above and this
      // insert. The unique index is what actually guarantees BR-01; re-read and give the
      // same answer the first check would have given.
      if (isMobileTaken(error)) {
        const owner = await db.customer.findUnique({
          where: { mobile: input.mobile },
          select: { id: true, name: true },
        });
        if (owner) throw alreadyExists(owner);
      }
      throw error;
    }
  },
});

function isMobileTaken(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error["code"] === "P2002"
  );
}

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
      if (isMobileTaken(error) && mobile) {
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

// BR-01 for the alternate number: search finds a customer by either number (M05.04), so
// an alternate that is already someone's main or alternate number would make one number
// find two people. There is no unique index on altMobile, so this check is the guard.
async function assertAltMobileFree(altMobile: string, exceptId?: string): Promise<void> {
  const owner = await db.customer.findFirst({
    where: {
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [{ mobile: altMobile }, { altMobile }],
    },
    select: { name: true },
  });
  if (owner) {
    throw new AppError("CONFLICT", {
      message: "customers.errors.mobileTaken",
      field: "altMobile",
      values: { name: owner.name },
    });
  }
}

// Dates compare by value; everything else here is a string or null.
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}
