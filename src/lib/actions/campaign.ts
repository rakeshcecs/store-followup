"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { previewAudience } from "@/lib/campaigns/audience";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isoDate } from "@/lib/format";
import { enqueue } from "@/lib/jobs/queue";
import { accessScope, assertBranchAccess, branchWhereShared, isAdmin } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { campaignWeeklyLimit } from "@/lib/settings";
import {
  cancelCampaignInput,
  createCampaignInput,
  previewCampaignInput,
} from "@/lib/validation/campaign";

// M23 campaigns: a manager for the branches they work in, an admin for any branch or
// for all of them at once. Salespeople have no part in this (SOW permission table).

const MANAGERS = { roles: ["MANAGER" as const, "ADMIN" as const] };

// "all" → null (every branch), which only an admin may choose; a branch id must be one
// the person reaches.
function campaignBranchId(user: SessionUser, branch: string): string | null {
  if (branch === "all") {
    if (!isAdmin(user)) throw new AppError("FORBIDDEN", { message: "branch.errors.noAccess" });
    return null;
  }
  assertBranchAccess(user, branch);
  return branch;
}

async function approvedTemplate(templateId: string) {
  const template = await db.whatsAppTemplate.findFirst({
    where: { id: templateId, active: true, metaStatus: "APPROVED" },
    select: { id: true, variables: true, language: true },
  });
  if (!template) {
    throw new AppError("RULE", {
      message: "whatsapp.errors.templateNotApproved",
      field: "templateId",
    });
  }
  // Every placeholder must be filled, and nothing beyond the placeholders.
  return template;
}

function assertVariablesCover(
  template: { variables: unknown },
  variables: Record<string, unknown>,
) {
  const names = Array.isArray(template.variables) ? (template.variables as string[]) : [];
  if (
    names.some((name) => !variables[name]) ||
    Object.keys(variables).some((k) => !names.includes(k))
  ) {
    throw new AppError("VALIDATION", { message: "campaigns.errors.fillEvery", field: "variables" });
  }
}

export const previewCampaign = safeAction({
  name: "previewCampaign",
  schema: previewCampaignInput,
  auth: MANAGERS,
  handler: async (input, { user }) => {
    const branchId = campaignBranchId(user, input.branch);
    const template = await approvedTemplate(input.templateId);
    assertVariablesCover(template, input.variables);
    const now = new Date();
    const preview = await previewAudience(
      {
        branchId,
        filters: input.filters,
        template,
        variables: input.variables,
        weeklyLimit: await campaignWeeklyLimit(),
      },
      now,
      isoDate(now),
    );
    return { counts: preview.counts, sample: preview.sample };
  },
});

// Saved as SCHEDULED with its send job (runAt = the scheduled time, or now). The worker
// finds the audience again when it runs, so a customer who says STOP in between is
// left out.
export const createCampaign = safeAction({
  name: "createCampaign",
  schema: createCampaignInput,
  auth: MANAGERS,
  handler: async (input, { user }) => {
    const branchId = campaignBranchId(user, input.branch);
    const template = await approvedTemplate(input.templateId);
    assertVariablesCover(template, input.variables);
    const now = new Date();
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : now;
    // A minute's grace for a clock that is slightly off; anything earlier is a mistake.
    if (scheduledAt.getTime() < now.getTime() - 60_000) {
      throw new AppError("VALIDATION", {
        message: "campaigns.errors.schedulePast",
        field: "scheduledAt",
      });
    }
    const device = (await headers()).get("user-agent");
    const campaign = await db.$transaction(async (tx) => {
      const row = await tx.campaign.create({
        data: {
          branchId,
          name: input.name,
          templateId: template.id,
          filters: input.filters as unknown as Prisma.InputJsonValue,
          variables: input.variables as unknown as Prisma.InputJsonValue,
          scheduledAt,
          status: "SCHEDULED",
          createdById: user.id,
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        userId: user.id,
        branchId,
        action: AUDIT.campaignCreate,
        entityType: "Campaign",
        entityId: row.id,
        newValue: {
          name: input.name,
          templateId: template.id,
          scheduledAt,
          filters: input.filters,
          variables: input.variables,
        },
        device,
      });
      return row;
    });
    await enqueue(
      "campaign-send",
      { campaignId: campaign.id },
      { runAt: scheduledAt, singletonKey: `campaign-send:${campaign.id}` },
    );
    revalidatePath("/campaigns");
    return { id: campaign.id };
  },
});

// Only while SCHEDULED: once the worker has started, messages are on their way.
export const cancelCampaign = safeAction({
  name: "cancelCampaign",
  schema: cancelCampaignInput,
  auth: MANAGERS,
  handler: async (input, { user }) => {
    const campaign = await db.campaign.findFirst({
      where: { AND: [{ id: input.id }, branchWhereShared(accessScope(user))] },
      select: { id: true, branchId: true, status: true, name: true },
    });
    if (!campaign) throw new AppError("NOT_FOUND");
    // An all-branches campaign is the admin's; a manager may read it, not stop it.
    if (campaign.branchId === null && !isAdmin(user)) throw new AppError("FORBIDDEN");
    if (campaign.status !== "SCHEDULED") {
      throw new AppError("RULE", { message: "campaigns.errors.notScheduled" });
    }
    const device = (await headers()).get("user-agent");
    await db.$transaction(async (tx) => {
      const { count } = await tx.campaign.updateMany({
        where: { id: campaign.id, status: "SCHEDULED" },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id },
      });
      if (count === 0) throw new AppError("RULE", { message: "campaigns.errors.notScheduled" });
      await writeAudit(tx, {
        userId: user.id,
        branchId: campaign.branchId,
        action: AUDIT.campaignCancel,
        entityType: "Campaign",
        entityId: campaign.id,
        oldValue: { status: "SCHEDULED" },
        newValue: { status: "CANCELLED", name: campaign.name },
        device,
      });
    });
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaign.id}`);
    return { cancelled: true };
  },
});
