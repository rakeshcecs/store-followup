"use server";

import argon2 from "argon2";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { Prisma, Role } from "@/generated/prisma/client";
import { requireUser, type RequireUserOptions, type SessionUser } from "@/lib/auth";
import { AUDIT, writeAudit } from "@/lib/audit";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { assertDepartmentUsable } from "@/lib/departments";
import { AppError } from "@/lib/errors";
import { assertBranchAccess } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { staffInScope } from "@/lib/staff-scope";
import { assertMayDeactivate, writeStaffStatus } from "@/lib/staff-status";
import { hasOpenWork, openWorkFor } from "@/lib/staff-work";
import { generateTempPin } from "@/lib/temp-pin";
import { createStaffInput, setStaffStatusInput, updateStaffInput } from "@/lib/validation/staff";

// Only an admin creates or edits staff. A manager's one power here is resetting a PIN,
// which is `resetPin` in src/lib/actions/auth.ts.
const ADMIN_ONLY: RequireUserOptions = { roles: ["ADMIN"] };

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

// A date input gives "2026-09-23" and the column is @db.Date. Parsing it as UTC midnight
// keeps the day the day: a local-midnight Date would shift back a day in IST.
function calendarDate(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

// "This mobile number is already used by [name]." — the name is the point: without it an
// admin has to hunt for a row they may not even be able to see.
async function assertMobileFree(mobile: string, exceptId?: string): Promise<void> {
  const owner = await db.user.findUnique({
    where: { mobile },
    select: { id: true, fullName: true },
  });
  if (!owner || owner.id === exceptId) return;
  throw new AppError("CONFLICT", {
    message: "staff.errors.mobileTaken",
    field: "mobile",
    values: { name: owner.fullName },
  });
}

// Extra branches are a manager's thing (SOW: "For managers covering more than one
// branch"). A salesperson works in one shop, and an admin reaches every branch without
// any membership row at all, so for both of them the list can only be a mistake.
//
// The home branch is dropped rather than refused: an admin who moves someone's home
// branch to one already in their extras is doing something perfectly sensible, and a
// UserBranch row for the home branch would count that person twice when a branch asks
// whether any staff still work there.
function extraBranchesFor(
  actor: SessionUser,
  input: { role: Role; homeBranchId: string; extraBranchIds: string[] },
): string[] {
  const wanted = [...new Set(input.extraBranchIds)].filter((id) => id !== input.homeBranchId);
  if (wanted.length === 0) return [];

  if (input.role !== "MANAGER") {
    throw new AppError("RULE", {
      message: "staff.errors.extraBranchesManagerOnly",
      field: "extraBranchIds",
    });
  }
  for (const branchId of wanted) assertBranchAccess(actor, branchId);
  return wanted;
}

// Replaces the whole set, so a branch taken off the chips is really taken away.
async function syncExtraBranches(
  tx: Prisma.TransactionClient,
  userId: string,
  branchIds: string[],
): Promise<void> {
  await tx.userBranch.deleteMany({ where: { userId } });
  if (branchIds.length > 0) {
    await tx.userBranch.createMany({ data: branchIds.map((branchId) => ({ userId, branchId })) });
  }
}

// A switched-off branch has no screens anyone can work on (M17), so nobody new is placed
// there. Someone already there keeps it, so their other details can still be saved.
async function assertHomeBranchActive(branchId: string, current?: string): Promise<void> {
  if (branchId === current) return;
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { status: true } });
  if (branch?.status !== "ACTIVE") {
    throw new AppError("RULE", { message: "staff.errors.branchInactive", field: "homeBranchId" });
  }
}

// Nobody changes their own role. An admin making themselves a manager was the one way
// round the "last active admin" guard (the actor is always an active admin, so demoting
// anyone else leaves at least them).
function assertMayChangeRole(actor: SessionUser, staff: { id: string; role: Role }, role: Role) {
  if (staff.role !== role && staff.id === actor.id) {
    throw new AppError("RULE", { message: "staff.errors.cannotChangeOwnRole", field: "role" });
  }
}

// Loaded for every write, so an admin on one branch cannot edit another branch's people
// by posting an id. NOT_FOUND, not FORBIDDEN: existence is itself information.
async function loadStaffInScope(id: string) {
  const user = await requireUser(ADMIN_ONLY);
  const scope = await getBranchScope(user);
  const staff = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      role: true,
      status: true,
      homeBranchId: true,
      departmentId: true,
      joinedOn: true,
      extraBranches: { select: { branchId: true } },
    },
  });
  if (!staff || !staffInScope(staff, scope)) throw new AppError("NOT_FOUND");
  return { actor: user, staff };
}

export const createStaff = safeAction({
  name: "createStaff",
  schema: createStaffInput,
  auth: ADMIN_ONLY,
  handler: async (input, { user }) => {
    assertBranchAccess(user, input.homeBranchId);
    await assertHomeBranchActive(input.homeBranchId);
    const extraBranchIds = extraBranchesFor(user, input);
    await assertMobileFree(input.mobile);
    await assertDepartmentUsable(input.departmentId);

    // Shown to the admin once and never stored in readable form. mustChangePin sends the
    // new person to /set-pin at their first login (M02).
    const tempPin = generateTempPin();

    const created = await db.$transaction(async (tx) => {
      const staff = await tx.user.create({
        data: {
          fullName: input.fullName,
          mobile: input.mobile,
          role: input.role,
          homeBranchId: input.homeBranchId,
          departmentId: input.departmentId ?? null,
          joinedOn: calendarDate(input.joinedOn),
          language: input.language,
          pinHash: await argon2.hash(tempPin),
          mustChangePin: true,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      await syncExtraBranches(tx, staff.id, extraBranchIds);

      await writeAudit(tx, {
        userId: user.id,
        branchId: staff.homeBranchId,
        action: AUDIT.userCreate,
        entityType: "User",
        entityId: staff.id,
        // No pinHash and no PIN: an audit row is read by other people later.
        newValue: {
          fullName: staff.fullName,
          mobile: staff.mobile,
          role: staff.role,
          homeBranchId: staff.homeBranchId,
          departmentId: staff.departmentId,
          extraBranchIds,
        },
        device: await device(),
      });

      return staff;
    });

    revalidatePath("/staff");
    // fullName comes back so the screen can name the person in the one-time PIN dialog
    // without reading it out of the form again.
    return { id: created.id, fullName: created.fullName, tempPin };
  },
});

export const updateStaff = safeAction({
  name: "updateStaff",
  schema: updateStaffInput,
  auth: ADMIN_ONLY,
  handler: async (input) => {
    const { actor, staff } = await loadStaffInScope(input.id);
    assertBranchAccess(actor, input.homeBranchId);
    await assertHomeBranchActive(input.homeBranchId, staff.homeBranchId);
    assertMayChangeRole(actor, staff, input.role);
    const extraBranchIds = extraBranchesFor(actor, input);
    await assertMobileFree(input.mobile, staff.id);
    await assertDepartmentUsable(input.departmentId, staff.departmentId);

    await db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: staff.id },
        data: {
          fullName: input.fullName,
          mobile: input.mobile,
          role: input.role,
          homeBranchId: input.homeBranchId,
          departmentId: input.departmentId ?? null,
          joinedOn: calendarDate(input.joinedOn),
          language: input.language,
          updatedById: actor.id,
        },
      });

      await syncExtraBranches(tx, staff.id, extraBranchIds);

      await writeAudit(tx, {
        userId: actor.id,
        branchId: updated.homeBranchId,
        action: AUDIT.userUpdate,
        entityType: "User",
        entityId: updated.id,
        oldValue: {
          fullName: staff.fullName,
          role: staff.role,
          homeBranchId: staff.homeBranchId,
          departmentId: staff.departmentId,
          extraBranchIds: staff.extraBranches.map((row) => row.branchId),
        },
        newValue: {
          fullName: updated.fullName,
          role: updated.role,
          homeBranchId: updated.homeBranchId,
          departmentId: updated.departmentId,
          extraBranchIds,
        },
        device: await device(),
      });
    });

    revalidatePath("/staff");
    // Same shape as createStaff, minus the PIN, so the form can read one result type.
    return { id: staff.id, fullName: input.fullName };
  },
});

export const setStaffStatus = safeAction({
  name: "setStaffStatus",
  schema: setStaffStatusInput,
  auth: ADMIN_ONLY,
  handler: async ({ id, status }) => {
    const { actor, staff } = await loadStaffInScope(id);
    if (staff.status === status) return { id: staff.id, status };

    if (status === "INACTIVE") {
      await assertMayDeactivate(db, actor, staff);

      const open = await openWorkFor(db, staff.id);
      // BR-15: their customers and pending follow-ups must go to someone else first — the
      // screen links to the reassign screen, which can deactivate them at the end (M15).
      if (hasOpenWork(open)) {
        throw new AppError("RULE", {
          message: "staff.errors.reassignFirst",
          values: { customers: open.customers, followUps: open.followUps },
        });
      }
    }

    const agent = await device();
    await db.$transaction((tx) => writeStaffStatus(tx, { actor, staff, status, device: agent }));

    revalidatePath("/staff");
    return { id: staff.id, status };
  },
});
