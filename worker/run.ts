import { hostname } from "node:os";
import { db } from "@/lib/db";
import { claimJobs, completeJob, failJob, releaseStaleJobs } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { handlers, type JobHandler } from "./jobs";
import { startSchedules } from "./schedules";

export const workerId = `${hostname()}:${process.pid}`;

// One pass: free stuck jobs, take due jobs, run each. Returns how many jobs ran.
export async function runOnce(
  id = workerId,
  registry: Record<string, JobHandler> = handlers,
): Promise<number> {
  await releaseStaleJobs();
  const jobs = await claimJobs(id);
  for (const job of jobs) {
    const handler = registry[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type "${job.type}"`);
      await handler(job);
      await completeJob(job.id);
    } catch (error) {
      const updated = await failJob(job.id, error, { retry: Boolean(handler) });
      logger.error("job.failed", error, { jobId: job.id, type: job.type, status: updated.status });
    }
  }
  return jobs.length;
}

export async function startWorker(): Promise<void> {
  const pollMs = Number(process.env.WORKER_POLL_MS ?? 5000);
  const schedules = startSchedules();
  let stopping = false;
  let wake: (() => void) | undefined;

  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("worker.stopping", { signal });
    wake?.(); // skip the rest of the current wait; a running job still finishes first
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  logger.info("worker.started", { workerId, pollMs });
  while (!stopping) {
    try {
      const ran = await runOnce();
      if (ran > 0) continue; // more work may be waiting
    } catch (error) {
      logger.error("worker.loop_error", error);
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, pollMs);
    });
  }

  await Promise.all(schedules.map((task) => task.stop()));
  await db.$disconnect();
  logger.info("worker.stopped", { workerId });
}
