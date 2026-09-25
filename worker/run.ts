import { hostname } from "node:os";
import { db } from "@/lib/db";
import { claimJobs, completeJob, failJob, releaseStaleJobs, touchJob } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { handlers, type JobHandler } from "./jobs";
import { startSchedules } from "./schedules";

export const workerId = `${hostname()}:${process.pid}`;

// Well inside releaseStaleJobs()' 10 minutes.
const HEARTBEAT_MS = 60_000;

// One pass: free stuck jobs, take due jobs, run each. Returns how many jobs ran.
export async function runOnce(
  id = workerId,
  registry: Record<string, JobHandler> = handlers,
): Promise<number> {
  await releaseStaleJobs();
  const jobs = await claimJobs(id);
  // Every claimed job not finished yet, the ones still waiting their turn included.
  const unfinished = new Set(jobs.map((job) => job.id));
  const beat = setInterval(() => {
    for (const jobId of unfinished) {
      touchJob(jobId, id).catch((error) => logger.error("job.heartbeat_failed", error));
    }
  }, HEARTBEAT_MS);
  try {
    for (const job of jobs) {
      const handler = registry[job.type];
      try {
        if (!handler) throw new Error(`No handler for job type "${job.type}"`);
        await handler(job);
        await completeJob(job.id, id);
      } catch (error) {
        const updated = await failJob(job.id, error, { retry: Boolean(handler), workerId: id });
        logger.error("job.failed", error, {
          jobId: job.id,
          type: job.type,
          status: updated.status,
        });
      } finally {
        unfinished.delete(job.id);
      }
    }
  } finally {
    clearInterval(beat);
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
