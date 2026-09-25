import type { Job } from "@/generated/prisma/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import { createOccasionFollowUps } from "@/lib/occasions";

// M23: the 6 AM occasion follow-ups for the day. Safe to retry — a customer with a
// pending follow-up is skipped.
export async function handleOccasionFollowUps(job: Job): Promise<void> {
  const { date } = job.payload as JobPayloads["occasion-follow-ups"];
  const written = await createOccasionFollowUps(date);
  logger.info("job.occasions.done", { date, written });
}
