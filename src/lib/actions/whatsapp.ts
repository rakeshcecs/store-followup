"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeBranchId } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { encryptionConfigured } from "@/lib/secret-box";
import { writeTimelineEvent } from "@/lib/timeline";
import {
  automaticInput,
  connectionInput,
  recordConsentInput,
  sendTemplateInput,
  sendTextInput,
  templateMappingInput,
  testMessageInput,
  unknownHandledInput,
} from "@/lib/validation/whatsapp";
import { MetaError, sendTemplateMessage } from "@/lib/whatsapp/meta";
import { queueWhatsApp } from "@/lib/whatsapp/send";
import {
  automaticWhatsApp,
  connectionSummary,
  saveAutomatic,
  saveConnection,
  WHATSAPP_SETTING,
  whatsappConnection,
} from "@/lib/whatsapp/settings";
import { syncTemplates } from "@/lib/whatsapp/templates";

// M22. Sending and recording consent: every role (the profile and follow-up cards are
// everyone's). Settings, templates and the test message: admin only.

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

const ADMIN = { roles: ["ADMIN" as const] };

// ---- sending ----

export const sendWhatsAppTemplate = safeAction({
  name: "sendWhatsAppTemplate",
  schema: sendTemplateInput,
  auth: {},
  handler: async (input, { user }) => {
    const branchId = writeBranchId(user, await getCurrentBranch(user));
    const messageId = await queueWhatsApp({
      customerId: input.customerId,
      branchId,
      kind: "TEMPLATE",
      sentById: user.id,
      templateId: input.templateId,
      device: await device(),
    });
    revalidatePath(`/customers/${input.customerId}`);
    return { messageId };
  },
});

export const sendWhatsAppText = safeAction({
  name: "sendWhatsAppText",
  schema: sendTextInput,
  auth: {},
  handler: async (input, { user }) => {
    const branchId = writeBranchId(user, await getCurrentBranch(user));
    const messageId = await queueWhatsApp({
      customerId: input.customerId,
      branchId,
      kind: "TEXT",
      sentById: user.id,
      text: input.text,
      device: await device(),
    });
    revalidatePath(`/customers/${input.customerId}`);
    return { messageId };
  },
});

// "The customer agreed" — recorded with who and when, on the timeline and in the audit log.
export const recordWhatsAppConsent = safeAction({
  name: "recordWhatsAppConsent",
  schema: recordConsentInput,
  auth: {},
  handler: async (input, { user }) => {
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, active: true },
      select: { id: true, whatsappConsent: true, homeBranchId: true },
    });
    if (!customer) throw new AppError("NOT_FOUND");
    if (customer.whatsappConsent) return { saved: true };
    const userDevice = await device();
    await db.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { whatsappConsent: true, whatsappConsentAt: new Date(), updatedById: user.id },
      });
      await writeTimelineEvent(tx, {
        customerId: customer.id,
        staffId: user.id,
        kind: "whatsappConsent",
      });
      await writeAudit(tx, {
        userId: user.id,
        branchId: customer.homeBranchId,
        action: AUDIT.whatsappConsent,
        entityType: "Customer",
        entityId: customer.id,
        oldValue: { whatsappConsent: false },
        newValue: { whatsappConsent: true },
        device: userDevice,
      });
    });
    revalidatePath(`/customers/${customer.id}`);
    return { saved: true };
  },
});

// ---- settings (admin) ----

export const saveWhatsAppConnection = safeAction({
  name: "saveWhatsAppConnection",
  schema: connectionInput,
  auth: ADMIN,
  handler: async (input, { user }) => {
    if (!encryptionConfigured()) {
      throw new AppError("RULE", { message: "whatsapp.errors.noEncryptionKey" });
    }
    const before = await connectionSummary();
    const userDevice = await device();
    await db.$transaction(async (tx) => {
      await saveConnection(tx, input, user.id);
      await writeAudit(tx, {
        userId: user.id,
        action: AUDIT.settingUpdate,
        entityType: "Setting",
        entityId: WHATSAPP_SETTING.connection,
        // The secrets never go into the audit log — only that they were changed.
        oldValue: { phoneNumberId: before.phoneNumberId, wabaId: before.wabaId },
        newValue: {
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          changed: (["accessToken", "appSecret", "verifyToken"] as const).filter(
            (key) => input[key],
          ),
        },
        device: userDevice,
      });
    });
    revalidatePath("/settings/whatsapp");
    return { saved: true };
  },
});

// Meta's own sample template, which every new business account has: proves the number,
// the token and the recipient without any of our templates being approved yet.
const TEST_TEMPLATE = { name: "hello_world", language: "en_US" };

export const sendWhatsAppTest = safeAction({
  name: "sendWhatsAppTest",
  schema: testMessageInput,
  auth: ADMIN,
  handler: async (input) => {
    const connection = await whatsappConnection();
    if (!connection) throw new AppError("RULE", { message: "whatsapp.errors.notConnected" });
    try {
      const id = await sendTemplateMessage(connection, {
        to: input.mobile,
        ...TEST_TEMPLATE,
        parameters: [],
      });
      return { metaMessageId: id };
    } catch (error) {
      if (error instanceof MetaError) {
        throw new AppError("RULE", {
          message: "whatsapp.errors.meta",
          values: { reason: error.message, code: error.code },
        });
      }
      throw error;
    }
  },
});

export const syncWhatsAppTemplates = safeAction({
  name: "syncWhatsAppTemplates",
  schema: z.object({}),
  auth: ADMIN,
  handler: async (_input, { user }) => {
    const connection = await whatsappConnection();
    if (!connection) throw new AppError("RULE", { message: "whatsapp.errors.notConnected" });
    let result: { synced: number; skipped: number };
    try {
      result = await syncTemplates(connection);
    } catch (error) {
      if (error instanceof MetaError) {
        throw new AppError("RULE", {
          message: "whatsapp.errors.meta",
          values: { reason: error.message, code: error.code },
        });
      }
      throw error;
    }
    await writeAudit(db, {
      userId: user.id,
      action: AUDIT.settingUpdate,
      entityType: "Setting",
      entityId: "whatsapp:templates",
      newValue: result,
      device: await device(),
    });
    revalidatePath("/settings/whatsapp");
    return result;
  },
});

export const saveWhatsAppTemplateMapping = safeAction({
  name: "saveWhatsAppTemplateMapping",
  schema: templateMappingInput,
  auth: ADMIN,
  handler: async (input, { user }) => {
    const template = await db.whatsAppTemplate.findUnique({
      where: { id: input.templateId },
      select: { id: true, variables: true, mapping: true },
    });
    if (!template) throw new AppError("NOT_FOUND");
    const variables = Array.isArray(template.variables) ? (template.variables as string[]) : [];
    // Only the template's own placeholders, and every one of them.
    if (
      variables.some((variable) => !input.mapping[variable]) ||
      Object.keys(input.mapping).some((key) => !variables.includes(key))
    ) {
      throw new AppError("VALIDATION", { message: "whatsapp.errors.mapEvery", field: "mapping" });
    }
    const agent = await device();
    await db.$transaction(async (tx) => {
      await tx.whatsAppTemplate.update({
        where: { id: template.id },
        data: { mapping: input.mapping as Prisma.InputJsonValue },
      });
      await writeAudit(tx, {
        userId: user.id,
        action: AUDIT.settingUpdate,
        entityType: "WhatsAppTemplate",
        entityId: template.id,
        oldValue: template.mapping,
        newValue: input.mapping,
        device: agent,
      });
    });
    revalidatePath("/settings/whatsapp");
    return { saved: true };
  },
});

export const saveAutomaticWhatsApp = safeAction({
  name: "saveAutomaticWhatsApp",
  schema: automaticInput,
  auth: ADMIN,
  handler: async (input, { user }) => {
    // Switched on means a template that can go out: approved, synced, mapped.
    for (const [kind, item] of Object.entries(input)) {
      if (!item.enabled) continue;
      const template = item.templateId
        ? await db.whatsAppTemplate.findFirst({
            where: { id: item.templateId, active: true, metaStatus: "APPROVED" },
            select: { id: true },
          })
        : null;
      if (!template) {
        throw new AppError("VALIDATION", {
          message: "whatsapp.errors.pickTemplate",
          field: `${kind}.templateId`,
        });
      }
    }
    const value = {
      thankYou: { enabled: input.thankYou.enabled, templateId: input.thankYou.templateId ?? null },
      visitReminder: {
        enabled: input.visitReminder.enabled,
        templateId: input.visitReminder.templateId ?? null,
      },
      occasion: { enabled: input.occasion.enabled, templateId: input.occasion.templateId ?? null },
    };
    const before = await automaticWhatsApp();
    const userDevice = await device();
    await db.$transaction(async (tx) => {
      await saveAutomatic(tx, value, user.id);
      await writeAudit(tx, {
        userId: user.id,
        action: AUDIT.settingUpdate,
        entityType: "Setting",
        entityId: WHATSAPP_SETTING.automatic,
        oldValue: before,
        newValue: value,
        device: userDevice,
      });
    });
    revalidatePath("/settings/whatsapp");
    return { saved: true };
  },
});

// ---- unknown contacts (managers) ----

export const markUnknownHandled = safeAction({
  name: "markUnknownHandled",
  schema: unknownHandledInput,
  auth: { roles: ["MANAGER", "ADMIN"] },
  handler: async (input, { user }) => {
    const { count } = await db.whatsAppUnknownMessage.updateMany({
      where: { id: input.id, handledAt: null },
      data: { handledAt: new Date(), handledById: user.id },
    });
    if (count === 0) throw new AppError("NOT_FOUND");
    revalidatePath("/whatsapp/unknown");
    return { saved: true };
  },
});
