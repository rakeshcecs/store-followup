"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { RequireUserOptions } from "@/lib/auth";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { safeAction } from "@/lib/safe-action";
import {
  createDepartmentInput,
  renameDepartmentInput,
  setDepartmentStatusInput,
} from "@/lib/validation/department";

// Departments are store-wide, not per branch (there is no branchId on the model), so only
// an admin touches them.
const ADMIN_ONLY: RequireUserOptions = { roles: ["ADMIN"] };

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

const nameTaken = () =>
  new AppError("CONFLICT", { message: "departments.errors.nameTaken", field: "name" });

export const createDepartment = safeAction({
  name: "createDepartment",
  schema: createDepartmentInput,
  auth: ADMIN_ONLY,
  handler: async ({ name }, { user }) => {
    const created = await db
      .$transaction(async (tx) => {
        const department = await tx.department.create({ data: { name } });
        await writeAudit(tx, {
          userId: user.id,
          action: AUDIT.departmentCreate,
          entityType: "Department",
          entityId: department.id,
          newValue: { name: department.name },
          device: await device(),
        });
        return department;
      })
      // name is @unique: a second "Sales" is the one failure worth naming.
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? nameTaken() : error;
      });

    revalidatePath("/settings/departments");
    return { id: created.id };
  },
});

export const renameDepartment = safeAction({
  name: "renameDepartment",
  schema: renameDepartmentInput,
  auth: ADMIN_ONLY,
  handler: async ({ id, name }, { user }) => {
    const before = await db.department.findUnique({ where: { id }, select: { name: true } });
    if (!before) throw new AppError("NOT_FOUND");

    await db
      .$transaction(async (tx) => {
        await tx.department.update({ where: { id }, data: { name } });
        await writeAudit(tx, {
          userId: user.id,
          action: AUDIT.departmentUpdate,
          entityType: "Department",
          entityId: id,
          oldValue: { name: before.name },
          newValue: { name },
          device: await device(),
        });
      })
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? nameTaken() : error;
      });

    revalidatePath("/settings/departments");
    return { id };
  },
});

export const setDepartmentStatus = safeAction({
  name: "setDepartmentStatus",
  schema: setDepartmentStatusInput,
  auth: ADMIN_ONLY,
  handler: async ({ id, status }, { user }) => {
    const department = await db.department.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!department) throw new AppError("NOT_FOUND");
    if (department.status === status) return { id, status };

    await db.$transaction(async (tx) => {
      await tx.department.update({ where: { id }, data: { status } });
      await writeAudit(tx, {
        userId: user.id,
        action: status === "ACTIVE" ? AUDIT.departmentActivate : AUDIT.departmentDeactivate,
        entityType: "Department",
        entityId: id,
        oldValue: { status: department.status },
        newValue: { status },
        device: await device(),
      });
    });

    // Deactivating is deliberately not blocked, only warned about on screen: the SOW says
    // a department with staff or customers needs a warning, and old records keep pointing
    // at it. It simply stops being offered on new ones.
    revalidatePath("/settings/departments");
    revalidatePath("/staff");
    return { id, status };
  },
});

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
