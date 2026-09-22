import cron, { type ScheduledTask } from "node-cron";
import { enqueue } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";

const timezone = "Asia/Kolkata";

// Schedules only enqueue jobs; the singletonKey makes it safe to run several workers.
// M14 adds reminder times from Settings here.
export function startSchedules(): ScheduledTask[] {
  const purge = cron.schedule(
    "0 3 * * *", // every day 03:00 IST
    async ({ dateLocalIso }) => {
      await enqueue("purge-jobs", {}, { singletonKey: `purge-jobs:${dateLocalIso.slice(0, 10)}` });
      logger.info("schedule.enqueued", { type: "purge-jobs" });
    },
    { timezone, name: "purge-jobs", noOverlap: true },
  );
  return [purge];
}
