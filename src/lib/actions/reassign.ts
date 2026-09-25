"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { accessScope } from "@/lib/permissions";
import { moveCustomers, type ReassignResult } from "@/lib/reassign";
import { safeAction } from "@/lib/safe-action";
import { staffInScope } from "@/lib/staff-scope";
import { assertMayDeactivate, writeStaffStatus } from "@/lib/staff-status";
import { hasOpenWork, openWorkFor } from "@/lib/staff-work";
import { reassignInput } from "@/lib/validation/reassign";

const PERSON = {
  id: true,
  fullName: true,
  role: true,
  status: true,
  homeBranchId: true,
  extraBranches: { select: { branchId: true } },
} as const;

// M15: a manager or admin moves customers, with their pending follow-ups, from one person
// to another. Both people must be inside what the actor may reach — a manager hands work
// around their own branches only. The receiver must be an active salesperson.
//
// `deactivate` is the staff-exit path (M15.02, BR-15), admin only like every status
// change (M03): everything the person holds moves, and they are made inactive in the same
// transaction — or, if anything is left, nothing happens at all.
export const reassignCustomers = safeAction({
  name: "reassignCustomers",
  schema: reassignInput,
  auth: { roles: ["MANAGER", "ADMIN"] },
  handler: async (input, { user }): Promise<ReassignResult & { deactivated: boolean }> => {
    if (input.deactivate && user.role !== "ADMIN") throw new AppError("FORBIDDEN");

    const scope = accessScope(user);
    const [from, to] = await Promise.all([
      db.user.findUnique({ where: { id: input.fromId }, select: PERSON }),
      db.user.findUnique({ where: { id: input.toId }, select: PERSON }),
    ]);
    if (!from || !staffInScope(from, scope)) throw new AppError("NOT_FOUND");
    if (!to || !staffInScope(to, scope)) throw new AppError("NOT_FOUND", { field: "toId" });
    if (to.role !== "SALESPERSON" || to.status !== "ACTIVE") {
      throw new AppError("RULE", { message: "reassign.errors.toNotActive", field: "toId" });
    }

    const device = (await headers()).get("user-agent");
    const result = await db.$transaction(async (tx) => {
      if (input.deactivate) await assertMayDeactivate(tx, user, from);

      const moved = await moveCustomers(tx, {
        actorId: user.id,
        from,
        to,
        customerIds: input.customerIds,
        device,
      });
      if (moved.customers === 0) {
        throw new AppError("RULE", { message: "reassign.errors.nothingToMove" });
      }

      if (input.deactivate && from.status === "ACTIVE") {
        const left = await openWorkFor(tx, from.id);
        if (hasOpenWork(left)) {
          throw new AppError("RULE", {
            message: "reassign.errors.workLeft",
            values: { customers: left.customers, followUps: left.followUps },
          });
        }
        await writeStaffStatus(tx, { actor: user, staff: from, status: "INACTIVE", device });
        return { ...moved, deactivated: true };
      }
      return { ...moved, deactivated: false };
    });

    revalidatePath("/staff");
    revalidatePath("/follow-ups");
    return result;
  },
});
