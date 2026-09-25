// M24: reading import jobs for the screens — one by id (checked against the reader's
// branches) and the recent ones of the branches on screen.
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { branchWhere, canAccessBranch, type BranchScope } from "@/lib/permissions";

export async function loadImportJob(user: SessionUser, id: string) {
  const job = await db.importJob.findFirst({
    where: { id },
    include: { branch: { select: { name: true } } },
  });
  if (!job || !canAccessBranch(user, job.branchId)) return null;
  const uploader = await db.user.findUnique({
    where: { id: job.uploadedById },
    select: { fullName: true },
  });
  return { ...job, branchName: job.branch.name, uploaderName: uploader?.fullName ?? "" };
}

export const RECENT_IMPORTS = 20;

export async function recentImports(scope: BranchScope) {
  const jobs = await db.importJob.findMany({
    where: { ...branchWhere(scope), status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: RECENT_IMPORTS,
    select: {
      id: true,
      fileName: true,
      status: true,
      totalRows: true,
      imported: true,
      updated: true,
      skipped: true,
      errorRows: true,
      createdAt: true,
      uploadedById: true,
      branch: { select: { name: true } },
    },
  });
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: [...new Set(jobs.map((job) => job.uploadedById))] } },
        select: { id: true, fullName: true },
      })
    ).map((u) => [u.id, u.fullName]),
  );
  return jobs.map((job) => ({ ...job, uploaderName: names.get(job.uploadedById) ?? "" }));
}
