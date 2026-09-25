// Making someone active or inactive, shared by the staff list (M03) and the staff-exit
// path of reassignment (M15.02), which moves their work and deactivates them in one
// transaction. Not a "use server" module: these take a transaction client.
import type { Prisma, RecordStatus, Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import { AUDIT, writeAudit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { destroyAllSessions } from "@/lib/session";

type StaffRow = { id: string; role: Role; status: RecordStatus; homeBranchId: string };

// The guards the SOW does not name but the app needs: nobody signs themselves out for
// good, and the last active admin stays (same idea as M17's last active branch).
export async function assertMayDeactivate(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  staff: StaffRow,
): Promise<void> {
  if (staff.id === actor.id) {
    throw new AppError("RULE", { message: "staff.errors.cannotDeactivateSelf" });
  }
  if (staff.role === "ADMIN") {
    const otherAdmins = await tx.user.count({
      where: { role: "ADMIN", status: "ACTIVE", id: { not: staff.id } },
    });
    if (otherAdmins === 0) throw new AppError("RULE", { message: "staff.errors.lastAdmin" });
  }
}

export async function writeStaffStatus(
  tx: Prisma.TransactionClient,
  input: { actor: SessionUser; staff: StaffRow; status: RecordStatus; device: string | null },
): Promise<void> {
  const { actor, staff, status } = input;
  await tx.user.update({ where: { id: staff.id }, data: { status, updatedById: actor.id } });

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
    device: input.device,
  });
}
