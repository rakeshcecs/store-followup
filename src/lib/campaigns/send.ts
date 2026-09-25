// The worker's half of a campaign (M23): when its time comes, find the audience again,
// apply BR-19 (consent), BR-21 (the weekly limit) and the template's needs to each
// customer, and queue one WhatsApp message per customer. Each message carries a dedupeKey
// ("campaign:<campaignId>:<customerId>"), so a retried or twice-running job never sends
// anyone the same campaign twice. The messages then go out through the ordinary
// `whatsapp-send` jobs (M22), which check consent once more just before sending.
//
// branch-scope-exempt: the worker runs the one campaign its job names; the messages are
// filed under the campaign's branch, or each customer's home branch for an all-branches
// campaign.
import type { Prisma } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import {
  branchNamer,
  campaignFieldValues,
  loadAudience,
  storeNameIn,
  weeklyCampaignCount,
  type AudienceCounts,
} from "@/lib/campaigns/audience";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isoDate } from "@/lib/format";
import { logger } from "@/lib/logger";
import { campaignFilters, campaignVariables } from "@/lib/validation/campaign";
import { queueWhatsApp } from "@/lib/whatsapp/send";
import { fillCampaignTemplate } from "@/lib/whatsapp/templates";
import { campaignWeeklyLimit } from "@/lib/settings";

export const NOTIFICATION_CAMPAIGN_DONE = "campaign-done";
const PROGRESS_EVERY = 100;

export type RunCounts = AudienceCounts & { queued: number };

export function readCounts(value: unknown): RunCounts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const n = (key: string) => (typeof v[key] === "number" ? (v[key] as number) : 0);
  return {
    matched: n("matched"),
    noConsent: n("noConsent"),
    weeklyLimit: n("weeklyLimit"),
    missingField: n("missingField"),
    ready: n("ready"),
    queued: n("queued"),
  };
}

export const campaignDedupeKey = (campaignId: string, customerId: string) =>
  `campaign:${campaignId}:${customerId}`;

// Returns how many messages were queued, or null when the campaign was not due to run
// (cancelled, or already done).
export async function runCampaign(campaignId: string, now = new Date()): Promise<number | null> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      branchId: true,
      status: true,
      filters: true,
      variables: true,
      createdById: true,
      template: { select: { id: true, variables: true, language: true } },
    },
  });
  // SENDING too: a job retried after a crash carries on where it stopped.
  if (!campaign || (campaign.status !== "SCHEDULED" && campaign.status !== "SENDING")) return null;

  const filters = campaignFilters.parse(campaign.filters ?? {});
  const variables = campaignVariables.parse(campaign.variables ?? {});
  await db.campaign.update({
    where: { id: campaign.id },
    data: { status: "SENDING", startedAt: now },
  });

  const [customers, limit, storeName, branchName] = await Promise.all([
    loadAudience({ branchId: campaign.branchId, filters }, isoDate(now)),
    campaignWeeklyLimit(),
    storeNameIn(campaign.template.language),
    branchNamer(campaign.branchId),
  ]);
  const counts: RunCounts = {
    matched: customers.length,
    noConsent: 0,
    weeklyLimit: 0,
    missingField: 0,
    ready: 0,
    queued: 0,
  };
  const saveCounts = () =>
    db.campaign.update({
      where: { id: campaign.id },
      data: { counts: counts as unknown as Prisma.InputJsonValue },
    });

  let seen = 0;
  for (const customer of customers) {
    seen += 1;
    const dedupeKey = campaignDedupeKey(campaign.id, customer.id);
    // Written on an earlier run of this very campaign: counted, never sent again.
    if ((await db.whatsAppMessage.count({ where: { dedupeKey } })) > 0) {
      counts.ready += 1;
      counts.queued += 1;
      continue;
    }
    if (!customer.whatsappConsent) {
      counts.noConsent += 1;
      continue;
    }
    if ((await weeklyCampaignCount(customer.id, now)) >= limit) {
      counts.weeklyLimit += 1;
      continue;
    }
    const values = campaignFieldValues(customer, { storeName, branchName });
    if (!fillCampaignTemplate(campaign.template, variables, values).ok) {
      counts.missingField += 1;
      continue;
    }
    counts.ready += 1;
    try {
      const id = await queueWhatsApp(
        {
          customerId: customer.id,
          branchId: campaign.branchId ?? customer.homeBranchId,
          kind: "CAMPAIGN",
          sentById: null,
          templateId: campaign.template.id,
          dedupeKey,
          campaign: { id: campaign.id, variables, values },
        },
        now,
      );
      if (id !== null) counts.queued += 1;
      else counts.queued += 1; // its twin got there first: still one message
    } catch (error) {
      // Consent withdrawn between the audience query and now (a STOP), or the template
      // switched off: this customer is skipped, the campaign carries on.
      if (!(error instanceof AppError)) throw error;
      counts.ready -= 1;
      if (error.message === "whatsapp.errors.noConsent") counts.noConsent += 1;
      else counts.missingField += 1;
      logger.info("campaign.customer_skipped", { campaignId: campaign.id, reason: error.message });
    }
    if (seen % PROGRESS_EVERY === 0) await saveCounts();
  }

  const skipped = counts.noConsent + counts.weeklyLimit + counts.missingField;
  await db.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "DONE",
        finishedAt: new Date(),
        counts: counts as unknown as Prisma.InputJsonValue,
      },
    });
    await writeAudit(tx, {
      userId: null,
      branchId: campaign.branchId,
      action: AUDIT.campaignDone,
      entityType: "Campaign",
      entityId: campaign.id,
      newValue: counts,
    });
    // The bell for whoever made it: "Campaign sent — 380 messages, 12 customers skipped".
    await tx.notification.create({
      data: {
        userId: campaign.createdById,
        type: NOTIFICATION_CAMPAIGN_DONE,
        message: `${NOTIFICATION_CAMPAIGN_DONE}:${campaign.id}:${counts.queued}:${skipped}`,
        link: `/campaigns/${campaign.id}`,
      },
    });
  });
  return counts.queued;
}
