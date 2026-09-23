"use server";

import argon2 from "argon2";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser, type RequireUserOptions } from "@/lib/auth";
import { AUDIT, writeAudit } from "@/lib/audit";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertBranchAccess } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { destroyAllSessions } from "@/lib/session";
import { staffInScope } from "@/lib/staff-scope";
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
    await assertMobileFree(input.mobile);

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
          pinHash: await argon2.hash(tempPin),
          mustChangePin: true,
          createdById: user.id,
          updatedById: user.id,
        },
      });

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
    await assertMobileFree(input.mobile, staff.id);

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
          updatedById: actor.id,
        },
      });

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
        },
        newValue: {
          fullName: updated.fullName,
          role: updated.role,
          homeBranchId: updated.homeBranchId,
          departmentId: updated.departmentId,
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
      // Signing yourself out of the app for good is never what the click meant.
      if (staff.id === actor.id) {
        throw new AppError("RULE", { message: "staff.errors.cannotDeactivateSelf" });
      }

      if (staff.role === "ADMIN") {
        const otherAdmins = await db.user.count({
          where: { role: "ADMIN", status: "ACTIVE", id: { not: staff.id } },
        });
        // The same guard as the last active branch (M17): nobody left who can undo it.
        if (otherAdmins === 0) {
          throw new AppError("RULE", { message: "staff.errors.lastAdmin" });
        }
      }

      const open = await openWorkFor(db, staff.id);
      // BR-15: their customers and pending follow-ups must go to someone else first.
      // M15 turns this message into a link to the reassign screen.
      if (hasOpenWork(open)) {
        throw new AppError("RULE", {
          message: "staff.errors.reassignFirst",
          values: { customers: open.customers, followUps: open.followUps },
        });
      }
    }

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: staff.id },
        data: { status, updatedById: actor.id },
      });

      // A session outlives a deactivation by up to 30 days otherwise. getSessionUser()
      // already refuses an inactive user, so this is belt and braces — and it frees rows.
      if (status === "INACTIVE") await destroyAllSessions(tx, staff.id);

      await writeAudit(tx, {
        userId: actor.id,
        branchId: staff.homeBranchId,
        action: status === "ACTIVE" ? AUDIT.userActivate : AUDIT.userDeactivate,
        entityType: "User",
        entityId: staff.id,
        oldValue: { status: staff.status },
        newValue: { status },
        device: await device(),
      });
    });

    revalidatePath("/staff");
    return { id: staff.id, status };
  },
});
