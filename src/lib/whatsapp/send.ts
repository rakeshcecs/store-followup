// Sending WhatsApp messages (M22). A message is written first — QUEUED, on the customer's
// timeline, in the audit log — and the worker sends it (`whatsapp-send`), so a screen
// never waits on Meta and a failed send is retried (3 tries, 1 and 2 minutes apart).
//
// Every way in comes through queueWhatsApp(), which is where BR-19 and BR-20 hold:
// consent, approved templates only, free text only inside the 24-hour window.
//
// branch-scope-exempt: a message is written to the branch the caller names (writeBranchId
// in the action, the sale's or follow-up's own branch for automatic ones), and the worker
// loads the one message its job names.
import type { Language, WhatsAppKind } from "@/generated/prisma/client";
import { createTranslator } from "next-intl";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatDayDate } from "@/lib/format";
import { enqueue } from "@/lib/jobs/queue";
import { loadMessages } from "@/lib/messages";
import { writeTimelineEvent } from "@/lib/timeline";
import { MetaError, sendTemplateMessage, sendTextMessage } from "@/lib/whatsapp/meta";
import { whatsappConnection } from "@/lib/whatsapp/settings";
import type { CampaignVariables } from "@/lib/whatsapp/fields";
import {
  fillCampaignTemplate,
  fillTemplate,
  firstName,
  renderBody,
  type FieldValues,
} from "@/lib/whatsapp/templates";

// BR-20: free text only within 24 hours of the customer's last message.
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const TEXT_MAX = 1000;

export function windowEndsAt(lastInAt: Date | null): Date | null {
  return lastInAt ? new Date(lastInAt.getTime() + REPLY_WINDOW_MS) : null;
}

export function windowOpen(lastInAt: Date | null, now: Date): boolean {
  const end = windowEndsAt(lastInAt);
  return end !== null && end > now;
}

// What a template's placeholders can be filled with for this customer.
export async function fieldValues(input: {
  customerId: string;
  branchId: string;
  language: Language;
  saleId?: string;
  followUpId?: string;
}): Promise<FieldValues> {
  const [customer, branch, followUp, sale, messages] = await Promise.all([
    db.customer.findUniqueOrThrow({
      where: { id: input.customerId },
      select: { name: true, occasion: true },
    }),
    db.branch.findUnique({ where: { id: input.branchId }, select: { name: true } }),
    db.followUp.findFirst({
      where: input.followUpId
        ? { id: input.followUpId }
        : { customerId: input.customerId, status: "PENDING" },
      select: { dueDate: true },
    }),
    db.sale.findFirst({
      where: input.saleId
        ? { id: input.saleId }
        : { customerId: input.customerId, cancelled: false },
      orderBy: { createdAt: "desc" },
      select: { billNumber: true },
    }),
    loadMessages(input.language),
  ]);
  const t = createTranslator({ locale: input.language, messages, namespace: "app" });
  return {
    customerFirstName: firstName(customer.name),
    customerName: customer.name,
    storeName: t("storeName"),
    branchName: branch?.name ?? null,
    visitDate: followUp ? formatDayDate(followUp.dueDate, input.language) : null,
    billNumber: sale?.billNumber ?? null,
    occasion: customer.occasion,
  };
}

export type QueueInput = {
  customerId: string;
  branchId: string;
  kind: WhatsAppKind;
  sentById: string | null; // null: automatic
  templateId?: string;
  text?: string;
  dedupeKey?: string;
  saleId?: string;
  followUpId?: string;
  device?: string | null;
  // M23: a campaign fills the placeholders its own way (fixed text or a customer field),
  // with the values the campaign run already looked up for this customer.
  campaign?: { id: string; variables: CampaignVariables; values: FieldValues };
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error["code"] === "P2002"
  );
}

// Null when a message with the same dedupeKey exists already (automatic ones).
export async function queueWhatsApp(input: QueueInput, now = new Date()): Promise<string | null> {
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, active: true },
    select: { id: true, mobile: true, whatsappConsent: true, whatsappLastInAt: true },
  });
  if (!customer) throw new AppError("NOT_FOUND");
  // BR-19, checked here and again by the worker just before it sends.
  if (!customer.whatsappConsent || !customer.mobile) {
    throw new AppError("RULE", { message: "whatsapp.errors.noConsent" });
  }

  let body: string;
  let templateId: string | null = null;
  let parameters: string[] | null = null;
  let templateName: string | null = null;
  if (input.kind === "TEXT") {
    // BR-20: free text only while the customer's last message is under 24 hours old.
    if (!windowOpen(customer.whatsappLastInAt, now)) {
      throw new AppError("RULE", { message: "whatsapp.errors.windowClosed" });
    }
    body = (input.text ?? "").trim();
    if (!body)
      throw new AppError("VALIDATION", { message: "whatsapp.errors.textRequired", field: "text" });
  } else {
    const template = await db.whatsAppTemplate.findFirst({
      where: { id: input.templateId, active: true, metaStatus: "APPROVED" },
      select: { id: true, name: true, body: true, variables: true, mapping: true, language: true },
    });
    if (!template) {
      throw new AppError("RULE", {
        message: "whatsapp.errors.templateNotApproved",
        field: "templateId",
      });
    }
    const filled = input.campaign
      ? fillCampaignTemplate(template, input.campaign.variables, input.campaign.values)
      : fillTemplate(
          template,
          await fieldValues({
            customerId: customer.id,
            branchId: input.branchId,
            language: template.language,
            saleId: input.saleId,
            followUpId: input.followUpId,
          }),
        );
    if (!filled.ok) {
      throw new AppError("RULE", {
        message:
          filled.missing === "unmapped"
            ? "whatsapp.errors.templateNotMapped"
            : "whatsapp.errors.missingField",
        field: "templateId",
        values: { field: filled.missing },
      });
    }
    templateId = template.id;
    templateName = template.name;
    parameters = filled.parameters;
    body = renderBody(template.body, template.variables, filled.parameters);
  }

  let messageId: string;
  try {
    messageId = await db.$transaction(async (tx) => {
      const message = await tx.whatsAppMessage.create({
        data: {
          customerId: customer.id,
          branchId: input.branchId,
          templateId,
          direction: "OUT",
          kind: input.kind,
          body,
          variables: parameters ?? undefined,
          status: "QUEUED",
          sentById: input.sentById,
          dedupeKey: input.dedupeKey ?? null,
          campaignId: input.campaign?.id ?? null,
        },
        select: { id: true },
      });
      await writeTimelineEvent(tx, {
        customerId: customer.id,
        staffId: input.sentById,
        kind: "whatsappOut",
        detail: body,
        entityId: message.id,
        branchId: input.branchId,
      });
      await writeAudit(tx, {
        userId: input.sentById,
        branchId: input.branchId,
        action: AUDIT.whatsappSend,
        entityType: "WhatsAppMessage",
        entityId: message.id,
        newValue: {
          customerId: customer.id,
          kind: input.kind,
          template: templateName,
          campaignId: input.campaign?.id ?? null,
        },
        device: input.device ?? null,
      });
      return message.id;
    });
  } catch (error) {
    if (input.dedupeKey && isUniqueViolation(error)) return null;
    throw error;
  }

  await enqueue("whatsapp-send", { messageId }, { singletonKey: `whatsapp-send:${messageId}` });
  return messageId;
}

// ---- the worker's half ----

// Sends one queued message. Throws a MetaError worth retrying; anything that cannot work
// (no consent any more, a template problem, a bad number) is marked FAILED at once.
export async function deliverWhatsApp(messageId: string, lastTry: boolean): Promise<void> {
  const message = await db.whatsAppMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      status: true,
      kind: true,
      body: true,
      variables: true,
      customer: { select: { mobile: true, whatsappConsent: true } },
      template: { select: { name: true, metaLanguage: true, metaStatus: true, active: true } },
    },
  });
  if (!message || message.status !== "QUEUED") return; // sent already, or gone

  const fail = (error: string, code: string) =>
    db.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", error: error.slice(0, 1000), errorCode: code.slice(0, 20) },
    });

  // BR-19 once more: a STOP may have arrived since the message was queued.
  if (!message.customer.whatsappConsent || !message.customer.mobile) {
    await fail("customer has not agreed to WhatsApp messages", "no-consent");
    return;
  }
  if (
    message.kind !== "TEXT" &&
    (!message.template || message.template.metaStatus !== "APPROVED")
  ) {
    await fail("template is not approved", "template");
    return;
  }

  try {
    const connection = await whatsappConnection();
    if (!connection) throw new MetaError("WhatsApp is not connected", "not-connected", true);
    const metaMessageId =
      message.kind === "TEXT"
        ? await sendTextMessage(connection, { to: message.customer.mobile, body: message.body })
        : await sendTemplateMessage(connection, {
            to: message.customer.mobile,
            name: message.template!.name,
            language: message.template!.metaLanguage,
            parameters: Array.isArray(message.variables) ? (message.variables as string[]) : [],
          });
    await db.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: "SENT", metaMessageId, sentAt: new Date(), error: null, errorCode: null },
    });
  } catch (error) {
    const meta =
      error instanceof MetaError
        ? error
        : new MetaError(error instanceof Error ? error.message : String(error), "unknown", true);
    if (meta.retry && !lastTry) throw meta;
    await fail(meta.message, meta.code);
  }
}
