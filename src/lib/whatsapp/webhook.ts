// Meta's webhook (M22): delivery ticks for what we sent, and what customers send us.
//
// Incoming from a known number: saved on the customer (direction IN), on their timeline,
// the 24-hour reply window opened, and their salesperson told (bell + phone push). A STOP
// in any of our languages — or Meta's own "Stop promotions" button — switches WhatsApp
// consent off at once (BR-19). From an unknown number: kept for managers under "Unknown
// contacts". Meta sends the same event again when unsure, so every write is keyed on
// Meta's message id.
//
// branch-scope-exempt: Meta's events name messages and phone numbers, not branches; a
// reply is filed under the customer's home branch.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageStatus } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { writeTimelineEvent } from "@/lib/timeline";
import { appNumber } from "@/lib/whatsapp/meta";

// X-Hub-Signature-256: "sha256=" + HMAC-SHA256 of the raw body with the app secret.
export function validSignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(raw, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// "STOP", "Stop", "बंद", "બંધ" (M22), and Meta's marketing opt-out button.
const STOP_WORDS = new Set(["stop", "बंद", "બંધ", "stop promotions", "unsubscribe"]);

export function isStop(text: string): boolean {
  return STOP_WORDS.has(
    text
      .trim()
      .toLowerCase()
      .replace(/[.!।]+$/u, ""),
  );
}

// Meta's statuses only move forward (sent → delivered → read); they can arrive out of
// order. A failure after "read" is not believed.
const RANK: Record<MessageStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 1,
};
const FROM_META: Record<string, MessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

type MetaStatus = {
  id: string;
  status: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};
type MetaIncoming = {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};
type MetaValue = {
  statuses?: MetaStatus[];
  messages?: MetaIncoming[];
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
};
export type MetaWebhook = { object?: string; entry?: { changes?: { value?: MetaValue }[] }[] };

const at = (timestamp: string | undefined, now: Date) =>
  timestamp && /^\d+$/.test(timestamp) ? new Date(Number(timestamp) * 1000) : now;

async function applyStatus(status: MetaStatus, now: Date): Promise<void> {
  const next = FROM_META[status.status];
  if (!next) return;
  const message = await db.whatsAppMessage.findUnique({
    where: { metaMessageId: status.id },
    select: { id: true, status: true },
  });
  if (!message) return;
  const when = at(status.timestamp, now);
  if (next === "FAILED") {
    if (message.status === "READ" || message.status === "DELIVERED") return;
    const error = status.errors?.[0];
    await db.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: "FAILED",
        error: (error?.error_data?.details || error?.message || error?.title || "failed").slice(
          0,
          1000,
        ),
        errorCode: String(error?.code ?? "failed").slice(0, 20),
      },
    });
    return;
  }
  if (RANK[next] <= RANK[message.status] && message.status !== "FAILED") return;
  await db.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: next,
      ...(next === "SENT" ? { sentAt: when } : {}),
      ...(next === "DELIVERED" ? { deliveredAt: when } : {}),
      ...(next === "READ" ? { readAt: when } : {}),
    },
  });
}

function textOf(message: MetaIncoming): string {
  return (
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    `[${message.type}]`
  ).slice(0, 4000);
}

async function applyIncoming(message: MetaIncoming, value: MetaValue, now: Date): Promise<void> {
  const seen =
    (await db.whatsAppMessage.count({ where: { metaMessageId: message.id } })) +
    (await db.whatsAppUnknownMessage.count({ where: { metaMessageId: message.id } }));
  if (seen > 0) return;

  const body = textOf(message);
  const receivedAt = at(message.timestamp, now);
  const mobile = appNumber(message.from);
  const customer = mobile
    ? await db.customer.findFirst({
        where: { active: true, OR: [{ mobile }, { altMobile: mobile }] },
        select: {
          id: true,
          homeBranchId: true,
          assignedToId: true,
          whatsappConsent: true,
          whatsappLastInAt: true,
        },
      })
    : null;

  if (!customer) {
    const profileName = value.contacts?.find((contact) => contact.wa_id === message.from)?.profile
      ?.name;
    await db.whatsAppUnknownMessage.create({
      data: {
        fromMobile: (mobile ?? message.from).slice(0, 20),
        profileName: profileName?.slice(0, 100) ?? null,
        body,
        metaMessageId: message.id,
        receivedAt,
      },
    });
    return;
  }

  const stop = isStop(body);
  await db.$transaction(async (tx) => {
    const saved = await tx.whatsAppMessage.create({
      data: {
        customerId: customer.id,
        branchId: customer.homeBranchId,
        direction: "IN",
        kind: "INCOMING",
        body,
        metaMessageId: message.id,
        status: "DELIVERED",
        deliveredAt: receivedAt,
      },
      select: { id: true },
    });
    const later =
      !customer.whatsappLastInAt || receivedAt > customer.whatsappLastInAt ? receivedAt : null;
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        ...(later ? { whatsappLastInAt: later } : {}),
        ...(stop ? { whatsappConsent: false, whatsappConsentAt: null } : {}),
      },
    });
    await writeTimelineEvent(tx, {
      customerId: customer.id,
      staffId: null,
      kind: "whatsappIn",
      detail: body,
      entityId: saved.id,
    });
    if (stop && customer.whatsappConsent) {
      await writeTimelineEvent(tx, {
        customerId: customer.id,
        staffId: null,
        kind: "whatsappStop",
      });
      await writeAudit(tx, {
        userId: null,
        branchId: customer.homeBranchId,
        action: AUDIT.whatsappStop,
        entityType: "Customer",
        entityId: customer.id,
        oldValue: { whatsappConsent: true },
        newValue: { whatsappConsent: false, via: "whatsapp-reply" },
      });
    }
    // The bell and a phone push (M14's sweep sends it) for whoever looks after them.
    await tx.notification.create({
      data: {
        userId: customer.assignedToId,
        type: stop ? "whatsapp-stop" : "whatsapp-in",
        message: `${stop ? "whatsapp-stop" : "whatsapp-in"}:${customer.id}`,
        link: `/customers/${customer.id}/whatsapp`,
      },
    });
  });
}

export async function handleWebhook(payload: MetaWebhook, now = new Date()): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const status of value.statuses ?? []) await applyStatus(status, now);
      for (const message of value.messages ?? []) await applyIncoming(message, value, now);
    }
  }
}
