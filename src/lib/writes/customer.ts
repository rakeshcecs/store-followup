// M05 New customer, shared by the Server Action and the offline sync (M19).
import { revalidatePath } from "next/cache";
import { AUDIT, writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertDepartmentUsable } from "@/lib/departments";
import { AppError } from "@/lib/errors";
import { branchScope, writeBranchId } from "@/lib/permissions";
import { staffBranchWhere } from "@/lib/staff-scope";
import { writeTimelineEvent } from "@/lib/timeline";
import type { CreateCustomerInput } from "@/lib/validation/customer";
import { isUniqueViolation, type WriteContext } from "@/lib/writes/context";

// "2026-09-23" into a @db.Date column. UTC midnight keeps the day the day: local
// midnight would shift back one day in IST.
export function calendarDate(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

// Thrown when the number is already taken (BR-01, M05.09). The form answers it by
// sending the person to the search screen for that number, where they get the existing
// customer's card — the SOW asks for the customer, not for an error nobody can act on.
// The id goes along for the offline sync's "Use existing customer" (M19).
export function alreadyExists(customer: { id: string; name: string }): AppError {
  return new AppError("CONFLICT", {
    message: "customers.errors.mobileTaken",
    field: "mobile",
    values: { name: customer.name, id: customer.id },
  });
}

// BR-01 for the alternate number: search finds a customer by either number (M05.04), so
// an alternate that is already someone's main or alternate number would make one number
// find two people. There is no unique index on altMobile, so this check is the guard.
export async function assertAltMobileFree(altMobile: string, exceptId?: string): Promise<void> {
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

// The same entry sent again — a retry, or the offline outbox resending after a lost
// answer — is the same customer, not a clash with itself.
async function sameEntry(clientId: string | undefined, userId: string) {
  if (!clientId) return null;
  const done = await db.customer.findUnique({
    where: { clientId },
    select: { id: true, name: true, createdById: true },
  });
  if (!done) return null;
  if (done.createdById !== userId) throw new AppError("CONFLICT");
  return { id: done.id, name: done.name };
}

export async function createCustomerCore(
  input: CreateCustomerInput,
  user: SessionUser,
  ctx: WriteContext,
): Promise<{ id: string; name: string }> {
  // The branch the customer is first recorded in. Customers are shared across
  // branches (BR-16); this only says where they walked in.
  const homeBranchId = writeBranchId(user, ctx.branch);

  const earlier = await sameEntry(input.clientId, user.id);
  if (earlier) return earlier;

  await assertDepartmentUsable(input.departmentId);

  // "Handled by" only offers people from the branch on screen, but the id arrives in a
  // form post and nothing stopped one from another branch — which would leave a
  // customer in branch A looked after by someone who does not work there.
  const assignee = await db.user.findFirst({
    where: {
      id: input.assignedToId,
      status: "ACTIVE",
      ...staffBranchWhere(branchScope(user, ctx.branch)),
    },
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

  const now = ctx.now;

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
          clientId: input.clientId ?? null,
          enteredOffline: ctx.offline,
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
        newValue: { ...customer, ...(ctx.offline ? { enteredOffline: true } : {}) },
        device: ctx.device,
      });

      return { id: customer.id, name: customer.name };
    });

    revalidatePath("/customers");
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // This very entry, saved by its twin a moment ago…
      const twin = await sameEntry(input.clientId, user.id);
      if (twin) return twin;
      // …or someone else inserted the same number between the check above and this
      // insert. The unique index is what actually guarantees BR-01; re-read and give
      // the same answer the first check would have given.
      const owner = await db.customer.findUnique({
        where: { mobile: input.mobile },
        select: { id: true, name: true },
      });
      if (owner) throw alreadyExists(owner);
    }
    throw error;
  }
}
