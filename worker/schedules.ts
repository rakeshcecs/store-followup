import cron, { type ScheduledTask } from "node-cron";
import { enqueue } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { pushPending } from "@/lib/push";
import { dueReminders } from "@/lib/reminders";
import { reminderTimes } from "@/lib/settings";

const timezone = "Asia/Kolkata";

// Once a minute (M14): read the reminder times from Settings — so a time changed by the
// admin applies from the next minute, with no restart — and enqueue whatever starts now.
// Also sweeps notifications not yet pushed (alerts written by the app itself).
// Schedules only enqueue jobs; the singletonKey makes it safe to run several workers.
export async function tick(now: Date): Promise<number> {
  const due = dueReminders(await reminderTimes(), now);
  for (const job of due) {
    await enqueue(job.type, job.payload, { singletonKey: job.singletonKey });
    logger.info("schedule.enqueued", { type: job.type, key: job.singletonKey });
  }
  // Inline, not a job: a job row every minute would be 1,440 rows a day of nothing.
  await pushPending();
  return due.length;
}

export function startSchedules(): ScheduledTask[] {
  const purge = cron.schedule(
    "0 3 * * *", // every day 03:00 IST
    async ({ dateLocalIso }) => {
      await enqueue("purge-jobs", {}, { singletonKey: `purge-jobs:${dateLocalIso.slice(0, 10)}` });
      logger.info("schedule.enqueued", { type: "purge-jobs" });
    },
    { timezone, name: "purge-jobs", noOverlap: true },
  );
  const minute = cron.schedule(
    "* * * * *",
    async () => {
      try {
        await tick(new Date());
      } catch (error) {
        logger.error("schedule.tick_failed", error);
      }
    },
    { timezone, name: "reminders-tick", noOverlap: true },
  );
  return [purge, minute];
}
