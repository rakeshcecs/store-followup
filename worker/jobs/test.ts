import type { Job } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";

// M01 check that the worker runs jobs end to end.
export async function handleTest(job: Job): Promise<void> {
  logger.info("job.test.done", { jobId: job.id });
}
