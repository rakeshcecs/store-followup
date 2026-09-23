// Audit trail. Nothing is ever hard-deleted (CLAUDE.md), so every create, edit and
// status change writes a row here. AuditLog has no foreign keys on purpose, so this
// is safe inside any transaction and can never block the write it records.
import type { Prisma } from "@/generated/prisma/client";

// Colon, not a dot: audit action names must never look like a next-intl message key.
export const AUDIT = {
  branchCreate: "branch:create",
  branchUpdate: "branch:update",
  branchActivate: "branch:activate",
  branchDeactivate: "branch:deactivate",
  userLocked: "user:locked",
  userPinReset: "user:pinReset",
  userCreate: "user:create",
  userUpdate: "user:update",
  userActivate: "user:activate",
  userDeactivate: "user:deactivate",
  departmentCreate: "department:create",
  departmentUpdate: "department:update",
  departmentActivate: "department:activate",
  departmentDeactivate: "department:deactivate",
} as const;

export type AuditInput = {
  userId?: string | null; // null = system/worker
  branchId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  device?: string | null;
};

// Prisma's Json input rejects Date and undefined, and audited rows are full model
// rows with timestamps, so round-trip through JSON (dates become ISO strings).
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function writeAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: input.userId ?? null,
      branchId: input.branchId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValue: toJson(input.oldValue),
      newValue: toJson(input.newValue),
      device: input.device?.slice(0, 255) ?? null,
    },
  });
}
