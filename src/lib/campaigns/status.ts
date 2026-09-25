import type { CampaignStatus } from "@/generated/prisma/client";

// The pill colour of each campaign state (M23), shared by the list and the detail page.
export const CAMPAIGN_STATUS_TONE: Record<
  CampaignStatus,
  "grey" | "blue" | "amber" | "green" | "red"
> = {
  DRAFT: "grey",
  SCHEDULED: "blue",
  SENDING: "amber",
  DONE: "green",
  CANCELLED: "grey",
};
