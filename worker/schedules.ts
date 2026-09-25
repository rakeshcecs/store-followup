import cron, { type ScheduledTask } from "node-cron";
import { enqueue } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { dueOccasionJob } from "@/lib/occasions";
import { pushPending } from "@/lib/push";
import { dueReminders } from "@/lib/reminders";
import { reminderTimes } from "@/lib/settings";

const timezone = "Asia/Kolkata";
const CATCH_UP_MINUTES = 15;

// Once a minute (M14): read the reminder times from Settings — so a time changed by the
// admin applies from the next minute, with no restart — and enqueue whatever starts now.
// Also sweeps notifications not yet pushed (alerts written by the app itself).
// Schedules only enqueue jobs; the singletonKey makes it safe to run several workers.
export async function tick(now: Date): Promise<number> {
  // The last 15 minutes, not just this one: a tick skipped because the one before was
  // still busy (noOverlap), or a worker restarted across 10:30, would otherwise lose that
  // reminder for the whole day. The singletonKey keeps the look-back from sending twice.
  const times = await reminderTimes();
  const due = new Map<string, ReturnType<typeof dueReminders>[number]>();
  for (let back = CATCH_UP_MINUTES - 1; back >= 0; back--) {
    for (const job of dueReminders(times, new Date(now.getTime() - back * 60_000))) {
      due.set(job.singletonKey, job);
    }
  }
  for (const job of due.values()) {
    await enqueue(job.type, job.payload, { singletonKey: job.singletonKey });
    logger.info("schedule.enqueued", { type: job.type, key: job.singletonKey });
  }
  // M23: today's occasion follow-ups, at 6 AM (and each hour after as a catch-up).
  const occasions = dueOccasionJob(now);
  if (occasions) {
    await enqueue(occasions.type, occasions.payload, { singletonKey: occasions.singletonKey });
  }
  // Inline, not a job: a job row every minute would be 1,440 rows a day of nothing.
  await pushPending();
  return due.size;
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
  // M16.05: only where a backup folder is set; a laptop running the worker has none.
  if (!process.env.BACKUP_DIR) {
    logger.info("schedule.backup_off", { reason: "BACKUP_DIR not set" });
    return [purge, minute];
  }
  const backup = cron.schedule(
    "0 2 * * *", // every day 02:00 IST, before the shop opens and after it closes
    async ({ dateLocalIso }) => {
      const date = dateLocalIso.slice(0, 10);
      await enqueue("db-backup", { date }, { singletonKey: `db-backup:${date}` });
      logger.info("schedule.enqueued", { type: "db-backup" });
    },
    { timezone, name: "db-backup", noOverlap: true },
  );
  return [purge, minute, backup];
}
