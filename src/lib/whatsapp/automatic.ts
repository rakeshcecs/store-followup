// M22 automatic messages, each switched on in Settings → WhatsApp with its template:
//   Thank you       1 hour after a sale is saved (looked for up to 6 hours, in case the
//                   worker was down)
//   Visit reminder  the evening before a "customer will visit" follow-up, from 6 PM
//   Occasion        on the occasion date, from 10 AM
// The worker's one-minute tick calls this. Each message has a dedupeKey, so running it
// every minute — or on two workers — sends each one once. Nothing after 9 PM.
//
// branch-scope-exempt: the worker looks across the whole store; each message is filed
// under the sale's or follow-up's own branch, or the customer's home branch.
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate, istHour } from "@/lib/format";
import { logger } from "@/lib/logger";
import { queueWhatsApp } from "@/lib/whatsapp/send";
import { automaticWhatsApp } from "@/lib/whatsapp/settings";

const HOUR = 60 * 60 * 1000;
const THANK_YOU_AFTER = 1 * HOUR;
const THANK_YOU_UNTIL = 6 * HOUR;
const VISIT_REMINDER_FROM = 18;
const OCCASION_FROM = 10;
const QUIET_FROM = 21; // no automatic message from 9 PM
const BATCH = 100;

// One warning per message that cannot be sent (a template needing a field the customer
// lacks), not one a minute.
const warned = new Set<string>();

const consenting = { active: true, whatsappConsent: true, mobile: { not: null } } as const;

// The candidates still waiting, at most BATCH of them. Taking the first 100 rows of the
// query instead handed back the same 100 every minute — already sent, or unsendable — and
// everything after them never got its message.
async function waiting<T>(rows: T[], key: (row: T) => string): Promise<T[]> {
  if (rows.length === 0) return [];
  const sent = new Set(
    (
      await db.whatsAppMessage.findMany({
        where: { dedupeKey: { in: rows.map(key) } },
        select: { dedupeKey: true },
      })
    ).map((row) => row.dedupeKey),
  );
  return rows.filter((row) => !sent.has(key(row)) && !warned.has(key(row))).slice(0, BATCH);
}

async function queueOne(
  input: Parameters<typeof queueWhatsApp>[0] & { dedupeKey: string },
): Promise<boolean> {
  const taken = await db.whatsAppMessage.count({ where: { dedupeKey: input.dedupeKey } });
  if (taken > 0) return false;
  try {
    return (await queueWhatsApp(input)) !== null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (!warned.has(input.dedupeKey)) {
      warned.add(input.dedupeKey);
      logger.info("whatsapp.automatic_skipped", { key: input.dedupeKey, reason: error.message });
    }
    return false;
  }
}

export async function queueAutomaticWhatsApp(now = new Date()): Promise<number> {
  const settings = await automaticWhatsApp();
  const hour = istHour(now);
  if (hour >= QUIET_FROM) return 0;
  let queued = 0;

  if (settings.thankYou.enabled && settings.thankYou.templateId) {
    const sales = await db.sale.findMany({
      where: {
        cancelled: false,
        createdAt: {
          lte: new Date(now.getTime() - THANK_YOU_AFTER),
          gte: new Date(now.getTime() - THANK_YOU_UNTIL),
        },
        customer: consenting,
      },
      select: { id: true, branchId: true, customerId: true },
      orderBy: { createdAt: "asc" },
    });
    for (const sale of await waiting(sales, (row) => `thanks:${row.id}`)) {
      if (
        await queueOne({
          customerId: sale.customerId,
          branchId: sale.branchId,
          kind: "THANK_YOU",
          sentById: null,
          templateId: settings.thankYou.templateId,
          saleId: sale.id,
          dedupeKey: `thanks:${sale.id}`,
        })
      )
        queued += 1;
    }
  }

  const today = isoDate(now);
  if (
    settings.visitReminder.enabled &&
    settings.visitReminder.templateId &&
    hour >= VISIT_REMINDER_FROM
  ) {
    const followUps = await db.followUp.findMany({
      where: {
        status: "PENDING",
        method: "VISIT",
        dueDate: calendarDay(addDays(today, 1)),
        customer: consenting,
      },
      select: { id: true, branchId: true, customerId: true },
      orderBy: { createdAt: "asc" },
    });
    for (const followUp of await waiting(followUps, (row) => `visit-reminder:${row.id}`)) {
      if (
        await queueOne({
          customerId: followUp.customerId,
          branchId: followUp.branchId,
          kind: "VISIT_REMINDER",
          sentById: null,
          templateId: settings.visitReminder.templateId,
          followUpId: followUp.id,
          dedupeKey: `visit-reminder:${followUp.id}`,
        })
      )
        queued += 1;
    }
  }

  if (settings.occasion.enabled && settings.occasion.templateId && hour >= OCCASION_FROM) {
    const customers = await db.customer.findMany({
      where: { ...consenting, occasionDate: calendarDay(today) },
      select: { id: true, homeBranchId: true },
      orderBy: { createdAt: "asc" },
    });
    for (const customer of await waiting(customers, (row) => `occasion:${row.id}:${today}`)) {
      if (
        await queueOne({
          customerId: customer.id,
          branchId: customer.homeBranchId,
          kind: "OCCASION",
          sentById: null,
          templateId: settings.occasion.templateId,
          dedupeKey: `occasion:${customer.id}:${today}`,
        })
      )
        queued += 1;
    }
  }
  return queued;
}
