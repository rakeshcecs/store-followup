"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { RequireUserOptions } from "@/lib/auth";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { safeAction } from "@/lib/safe-action";
import {
  createBranchInput,
  setBranchStatusInput,
  updateBranchInput,
} from "@/lib/validation/branch";

const ADMIN_ONLY: RequireUserOptions = { roles: ["ADMIN"] };

async function device() {
  return (await headers()).get("user-agent");
}

function isDuplicateName(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

// Two branches with the same name are indistinguishable in the switcher, so the
// error has to land on the name field rather than on the form.
const nameTaken = () =>
  new AppError("CONFLICT", { message: "branches.errors.nameTaken", field: "name" });

export const createBranch = safeAction({
  name: "createBranch",
  schema: createBranchInput,
  auth: ADMIN_ONLY,
  handler: async (input, { user }) => {
    const userAgent = await device();

    const branch = await db
      .$transaction(async (tx) => {
        const created = await tx.branch.create({
          data: { ...input, createdById: user.id, updatedById: user.id },
        });
        await writeAudit(tx, {
          userId: user.id,
          branchId: created.id,
          action: AUDIT.branchCreate,
          entityType: "Branch",
          entityId: created.id,
          newValue: created,
          device: userAgent,
        });
        return created;
      })
      .catch((error: unknown) => {
        if (isDuplicateName(error)) throw nameTaken();
        throw error;
      });

    revalidatePath("/branches");
    return { id: branch.id };
  },
});

export const updateBranch = safeAction({
  name: "updateBranch",
  schema: updateBranchInput,
  auth: ADMIN_ONLY,
  handler: async ({ id, ...input }, { user }) => {
    const userAgent = await device();

    await db
      .$transaction(async (tx) => {
        const before = await tx.branch.findUnique({ where: { id } });
        if (!before) throw new AppError("NOT_FOUND");

        // status is deliberately not editable here: it moves only through
        // setBranchStatus, which carries the "move the staff first" rule.
        const after = await tx.branch.update({
          where: { id },
          data: { ...input, updatedById: user.id },
        });

        await writeAudit(tx, {
          userId: user.id,
          branchId: id,
          action: AUDIT.branchUpdate,
          entityType: "Branch",
          entityId: id,
          oldValue: before,
          newValue: after,
          device: userAgent,
        });
      })
      .catch((error: unknown) => {
        if (isDuplicateName(error)) throw nameTaken();
        throw error;
      });

    revalidatePath("/branches");
    return { id };
  },
});

export const setBranchStatus = safeAction({
  name: "setBranchStatus",
  schema: setBranchStatusInput,
  auth: ADMIN_ONLY,
  handler: async ({ id, status }, { user }) => {
    const userAgent = await device();

    await db.$transaction(async (tx) => {
      const before = await tx.branch.findUnique({ where: { id }, select: { status: true } });
      if (!before) throw new AppError("NOT_FOUND");

      if (status === "INACTIVE") {
        // One OR count, not two: a user whose home branch is also in their extra
        // branches would otherwise be counted twice.
        const staff = await tx.user.count({
          where: {
            status: "ACTIVE",
            OR: [{ homeBranchId: id }, { extraBranches: { some: { branchId: id } } }],
          },
        });
        if (staff > 0) throw new AppError("RULE", { message: "branches.errors.staffPresent" });

        const otherActive = await tx.branch.count({
          where: { status: "ACTIVE", id: { not: id } },
        });
        if (otherActive === 0) {
          throw new AppError("RULE", { message: "branches.errors.lastActiveBranch" });
        }
      }

      // Never a hard delete: the row stays, only the status changes.
      await tx.branch.update({ where: { id }, data: { status, updatedById: user.id } });

      await writeAudit(tx, {
        userId: user.id,
        branchId: id,
        action: status === "ACTIVE" ? AUDIT.branchActivate : AUDIT.branchDeactivate,
        entityType: "Branch",
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status },
        device: userAgent,
      });
    });

    revalidatePath("/branches");
    return { id, status };
  },
});
