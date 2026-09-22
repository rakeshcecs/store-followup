import { purgeFinishedJobs } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";

export async function handlePurgeJobs(): Promise<void> {
  const removed = await purgeFinishedJobs();
  logger.info("job.purge.done", { removed });
}
