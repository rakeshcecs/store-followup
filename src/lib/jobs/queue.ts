import type { Job, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { JobPayloads, JobType } from "@/lib/jobs/types";

// MySQL-backed job queue (docs/decisions.md "Stack changes"). The app enqueues, worker/ runs.

type EnqueueOptions = {
  runAt?: Date;
  singletonKey?: string; // a second enqueue with the same key returns the existing job
  maxAttempts?: number;
};

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function enqueue<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  options: EnqueueOptions = {},
): Promise<Job> {
  try {
    return await db.job.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonValue,
        runAt: options.runAt ?? new Date(),
        singletonKey: options.singletonKey,
        maxAttempts: options.maxAttempts ?? 3,
      },
    });
  } catch (error) {
    if (options.singletonKey && isUniqueViolation(error)) {
      return db.job.findUniqueOrThrow({ where: { singletonKey: options.singletonKey } });
    }
    throw error;
  }
}

// Takes up to `limit` due jobs and marks them RUNNING. SKIP LOCKED means two workers
// never receive the same job.
export async function claimJobs(workerId: string, limit = 5): Promise<Job[]> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE status = 'PENDING' AND runAt <= NOW(3)
      ORDER BY runAt
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    await tx.job.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "RUNNING",
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: { increment: 1 },
      },
    });
    return tx.job.findMany({ where: { id: { in: ids } }, orderBy: { runAt: "asc" } });
  });
}

// With a workerId, only while that worker still holds the job: once a stale lock has
// been released and another worker has taken it, the first one's late answer must not
// overwrite the second one's state.
const heldBy = (workerId?: string) =>
  workerId ? { status: "RUNNING" as const, lockedBy: workerId } : {};

export async function completeJob(id: string, workerId?: string): Promise<void> {
  await db.job.updateMany({
    where: { id, ...heldBy(workerId) },
    data: { status: "DONE", finishedAt: new Date(), lockedAt: null, lockedBy: null },
  });
}

// A long job (a big import, a backup) says it is still alive, so releaseStaleJobs() does
// not hand it to a second worker while the first is still on it.
export async function touchJob(id: string, workerId: string): Promise<void> {
  await db.job.updateMany({
    where: { id, status: "RUNNING", lockedBy: workerId },
    data: { lockedAt: new Date() },
  });
}

// Retries later (1, 2, 4… minutes) until maxAttempts, then FAILED. Keeps the message only.
// retry: false fails at once (e.g. unknown job type — retrying cannot help).
export async function failJob(
  id: string,
  error: unknown,
  options: { retry?: boolean; workerId?: string } = {},
): Promise<Job> {
  const job = await db.job.findUniqueOrThrow({ where: { id } });
  if (options.workerId && (job.status !== "RUNNING" || job.lockedBy !== options.workerId)) {
    return job; // someone else holds it now
  }
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const giveUp = options.retry === false || job.attempts >= job.maxAttempts;
  return db.job.update({
    where: { id },
    data: giveUp
      ? {
          status: "FAILED",
          lastError: message,
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        }
      : {
          status: "PENDING",
          lastError: message,
          runAt: new Date(Date.now() + 2 ** (job.attempts - 1) * 60_000),
          lockedAt: null,
          lockedBy: null,
        },
  });
}

// RUNNING jobs whose worker crashed go back to PENDING.
export async function releaseStaleJobs(olderThanMinutes = 10): Promise<number> {
  const { count } = await db.job.updateMany({
    where: {
      status: "RUNNING",
      lockedAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) },
    },
    data: { status: "PENDING", lockedAt: null, lockedBy: null },
  });
  return count;
}

// Queue housekeeping: removes old DONE jobs (not business records). FAILED jobs stay for review.
export async function purgeFinishedJobs(olderThanDays = 30): Promise<number> {
  const { count } = await db.job.deleteMany({
    where: {
      status: "DONE",
      finishedAt: { lt: new Date(Date.now() - olderThanDays * 86_400_000) },
    },
  });
  return count;
}
