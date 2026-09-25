import type { Job } from "@/generated/prisma/client";
import { runCampaign } from "@/lib/campaigns/send";
import type { JobPayloads } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";

// M23: queues one campaign's messages when its scheduled time comes. A retry after a
// crash carries on: every message has a dedupeKey, so nobody gets the campaign twice.
export async function handleCampaignSend(job: Job): Promise<void> {
  const { campaignId } = job.payload as JobPayloads["campaign-send"];
  const queued = await runCampaign(campaignId);
  logger.info("job.campaign.done", { campaignId, queued });
}
