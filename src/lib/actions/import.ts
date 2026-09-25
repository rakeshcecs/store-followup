"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Prisma } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { errorOutcomes } from "@/lib/import/run";
import type { ImportRow } from "@/lib/import/types";
import { enqueue } from "@/lib/jobs/queue";
import { canAccessBranch } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { cancelImportInput, startImportInput } from "@/lib/validation/import";

// M24: a manager for their own branches, an admin for any (SOW permission table).

// branch-scope-exempt: each action loads one job by id and checks its branch with
// canAccessBranch() before touching it.
async function pendingJob(user: Parameters<typeof canAccessBranch>[0], jobId: string) {
  const job = await db.importJob.findUnique({ where: { id: jobId } });
  if (!job || !canAccessBranch(user, job.branchId)) throw new AppError("NOT_FOUND");
  if (job.status !== "PENDING") {
    throw new AppError("RULE", { message: "import.errors.notPending" });
  }
  return job;
}

// "Import [n] customers": hands the job to the worker. The page then shows the progress.
export const startImport = safeAction({
  name: "startImport",
  schema: startImportInput,
  auth: { roles: ["MANAGER", "ADMIN"] },
  handler: async (input, { user }) => {
    const job = await pendingJob(user, input.jobId);
    const work = job.readyRows + (input.updateExisting ? job.existingRows : 0);
    if (work === 0) throw new AppError("RULE", { message: "import.errors.nothingToImport" });

    const device = (await headers()).get("user-agent");
    await db.$transaction(async (tx) => {
      // Only one confirmation wins, however many times the button is pressed.
      const claimed = await tx.importJob.updateMany({
        where: { id: job.id, status: "PENDING" },
        data: {
          status: "PROCESSING",
          updateExisting: input.updateExisting,
          processed: 0,
          outcomes: errorOutcomes(
            (job.rows ?? []) as unknown as ImportRow[],
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      if (claimed.count === 0) throw new AppError("RULE", { message: "import.errors.notPending" });
      await writeAudit(tx, {
        userId: user.id,
        branchId: job.branchId,
        action: AUDIT.importCreate,
        entityType: "ImportJob",
        entityId: job.id,
        newValue: {
          fileName: job.fileName,
          totalRows: job.totalRows,
          ready: job.readyRows,
          existing: job.existingRows,
          mistakes: job.errorRows,
          updateExisting: input.updateExisting,
        },
        device,
      });
    });
    await enqueue(
      "customer-import",
      { importJobId: job.id },
      { singletonKey: `customer-import:${job.id}` },
    );
    revalidatePath(`/import/${job.id}`);
    return { jobId: job.id };
  },
});

// Throw the preview away. The rows go too: they are a copy of someone's customer list.
export const cancelImport = safeAction({
  name: "cancelImport",
  schema: cancelImportInput,
  auth: { roles: ["MANAGER", "ADMIN"] },
  handler: async (input, { user }) => {
    const job = await pendingJob(user, input.jobId);
    const device = (await headers()).get("user-agent");
    await db.$transaction(async (tx) => {
      // Still PENDING, checked in the write: a Start pressed a moment earlier has handed
      // the job to the worker, which is reading these rows.
      const cancelled = await tx.importJob.updateMany({
        where: { id: job.id, status: "PENDING" },
        data: { status: "CANCELLED", rows: Prisma.DbNull, finishedAt: new Date() },
      });
      if (cancelled.count === 0)
        throw new AppError("RULE", { message: "import.errors.notPending" });
      await writeAudit(tx, {
        userId: user.id,
        branchId: job.branchId,
        action: AUDIT.importCancel,
        entityType: "ImportJob",
        entityId: job.id,
        newValue: { fileName: job.fileName },
        device,
      });
    });
    revalidatePath("/import");
    return { ok: true };
  },
});
