// Reading campaigns for the screens (M23). A manager sees the campaigns of the branches in
// the switcher plus the admin's all-branches ones; an admin on All branches sees every one.
import type { CampaignStatus } from "@/generated/prisma/client";
import { campaignResultsMany, type CampaignResults } from "@/lib/campaigns/results";
import { readCounts, type RunCounts } from "@/lib/campaigns/send";
import { db } from "@/lib/db";
import { branchWhereShared, type BranchScope } from "@/lib/permissions";
import {
  campaignFilters,
  campaignVariables,
  type CampaignFilters,
} from "@/lib/validation/campaign";
import type { CampaignVariables } from "@/lib/whatsapp/fields";

export const LIST_MAX = 100;

export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  scheduledAt: Date;
  branchName: string | null; // null: all branches
  templateName: string;
  createdByName: string;
  counts: RunCounts | null;
  results: CampaignResults;
};

async function creatorNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((user) => [user.id, user.fullName]));
}

export async function listCampaigns(scope: BranchScope): Promise<CampaignRow[]> {
  const campaigns = await db.campaign.findMany({
    where: { AND: [branchWhereShared(scope)] },
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    take: LIST_MAX,
    select: {
      id: true,
      name: true,
      status: true,
      scheduledAt: true,
      counts: true,
      createdById: true,
      branch: { select: { name: true } },
      template: { select: { name: true } },
    },
  });
  const [results, names] = await Promise.all([
    campaignResultsMany(campaigns.map((campaign) => campaign.id)),
    creatorNames([...new Set(campaigns.map((campaign) => campaign.createdById))]),
  ]);
  return campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scheduledAt: campaign.scheduledAt,
    branchName: campaign.branch?.name ?? null,
    templateName: campaign.template.name,
    createdByName: names.get(campaign.createdById) ?? "",
    counts: readCounts(campaign.counts),
    results: results.get(campaign.id)!,
  }));
}

export type CampaignDetail = CampaignRow & {
  branchId: string | null;
  templateBody: string;
  templateVariables: string[];
  variables: CampaignVariables;
  filters: CampaignFilters;
  startedAt: Date | null;
  finishedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
};

// Null when there is no such campaign in this scope — the same answer for "does not
// exist" and "another branch's", so nothing leaks.
export async function loadCampaign(scope: BranchScope, id: string): Promise<CampaignDetail | null> {
  const campaign = await db.campaign.findFirst({
    where: { AND: [{ id }, branchWhereShared(scope)] },
    select: {
      id: true,
      name: true,
      status: true,
      scheduledAt: true,
      counts: true,
      createdById: true,
      branchId: true,
      filters: true,
      variables: true,
      startedAt: true,
      finishedAt: true,
      cancelledAt: true,
      createdAt: true,
      branch: { select: { name: true } },
      template: { select: { name: true, body: true, variables: true } },
    },
  });
  if (!campaign) return null;
  const [results, names] = await Promise.all([
    campaignResultsMany([campaign.id]),
    creatorNames([campaign.createdById]),
  ]);
  const parsedFilters = campaignFilters.safeParse(campaign.filters ?? {});
  const parsedVariables = campaignVariables.safeParse(campaign.variables ?? {});
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scheduledAt: campaign.scheduledAt,
    branchName: campaign.branch?.name ?? null,
    branchId: campaign.branchId,
    templateName: campaign.template.name,
    templateBody: campaign.template.body,
    templateVariables: Array.isArray(campaign.template.variables)
      ? (campaign.template.variables as string[])
      : [],
    variables: parsedVariables.success ? parsedVariables.data : {},
    filters: parsedFilters.success ? parsedFilters.data : campaignFilters.parse({}),
    createdByName: names.get(campaign.createdById) ?? "",
    counts: readCounts(campaign.counts),
    results: results.get(campaign.id)!,
    startedAt: campaign.startedAt,
    finishedAt: campaign.finishedAt,
    cancelledAt: campaign.cancelledAt,
    createdAt: campaign.createdAt,
  };
}
