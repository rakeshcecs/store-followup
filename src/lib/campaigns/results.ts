// What a campaign did (M23): the message ticks from WhatsAppMessage, and what the
// customers did afterwards — replied, visited within 30 days, bought within 30 days. Read
// straight from the records every time, so the results and the database cannot disagree
// (the module's "Done when").
//
// branch-scope-exempt: a campaign is opened within the reader's scope first
// (src/lib/campaigns/list.ts); its messages, and the visits and sales of its customers,
// are then read by that campaign's id whichever branch they happened in.
import { db } from "@/lib/db";

export const RESULT_WINDOW_DAYS = 30;
const WINDOW_MS = RESULT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type CampaignTotals = {
  recipients: number; // messages written for the campaign
  waiting: number; // still QUEUED
  sent: number; // SENT, DELIVERED or READ
  delivered: number; // DELIVERED or READ
  read: number;
  failed: number;
  replied: number;
  visited: number;
  bought: number;
};

export type RecipientResult = {
  customerId: string;
  messageId: string;
  status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  sentAt: Date;
  replied: boolean;
  visited: boolean;
  bought: boolean;
};

export type CampaignResults = { totals: CampaignTotals; recipients: RecipientResult[] };

const emptyTotals = (): CampaignTotals => ({
  recipients: 0,
  waiting: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  replied: 0,
  visited: 0,
  bought: 0,
});

// Several campaigns in four queries, for the list and the R10 report.
export async function campaignResultsMany(
  campaignIds: string[],
): Promise<Map<string, CampaignResults>> {
  const out = new Map<string, CampaignResults>();
  for (const id of campaignIds) out.set(id, { totals: emptyTotals(), recipients: [] });
  if (campaignIds.length === 0) return out;

  const messages = await db.whatsAppMessage.findMany({
    where: { campaignId: { in: campaignIds }, direction: "OUT" },
    select: { id: true, campaignId: true, customerId: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (messages.length === 0) return out;

  const customerIds = [...new Set(messages.map((message) => message.customerId))];
  const start = messages[0]!.createdAt;
  const end = new Date(
    Math.max(...messages.map((message) => message.createdAt.getTime())) + WINDOW_MS,
  );
  const after = { gt: start, lte: end };
  const [replies, visits, sales] = await Promise.all([
    db.whatsAppMessage.findMany({
      where: { customerId: { in: customerIds }, direction: "IN", createdAt: after },
      select: { customerId: true, createdAt: true },
    }),
    db.visit.findMany({
      where: { customerId: { in: customerIds }, visitAt: after },
      select: { customerId: true, visitAt: true },
    }),
    db.sale.findMany({
      where: { customerId: { in: customerIds }, cancelled: false, createdAt: after },
      select: { customerId: true, createdAt: true },
    }),
  ]);
  const byCustomer = <T>(rows: T[], id: (row: T) => string, at: (row: T) => Date) => {
    const map = new Map<string, Date[]>();
    for (const row of rows) map.set(id(row), [...(map.get(id(row)) ?? []), at(row)]);
    return map;
  };
  const replyTimes = byCustomer(
    replies,
    (r) => r.customerId,
    (r) => r.createdAt,
  );
  const visitTimes = byCustomer(
    visits,
    (v) => v.customerId,
    (v) => v.visitAt,
  );
  const saleTimes = byCustomer(
    sales,
    (s) => s.customerId,
    (s) => s.createdAt,
  );
  const within = (times: Date[] | undefined, from: Date) =>
    (times ?? []).some((time) => time > from && time.getTime() <= from.getTime() + WINDOW_MS);

  for (const message of messages) {
    const results = out.get(message.campaignId!)!;
    const row: RecipientResult = {
      customerId: message.customerId,
      messageId: message.id,
      status: message.status,
      sentAt: message.createdAt,
      replied: within(replyTimes.get(message.customerId), message.createdAt),
      visited: within(visitTimes.get(message.customerId), message.createdAt),
      bought: within(saleTimes.get(message.customerId), message.createdAt),
    };
    results.recipients.push(row);
    const t = results.totals;
    t.recipients += 1;
    if (row.status === "QUEUED") t.waiting += 1;
    if (row.status === "FAILED") t.failed += 1;
    if (row.status === "SENT" || row.status === "DELIVERED" || row.status === "READ") t.sent += 1;
    if (row.status === "DELIVERED" || row.status === "READ") t.delivered += 1;
    if (row.status === "READ") t.read += 1;
    if (row.replied) t.replied += 1;
    if (row.visited) t.visited += 1;
    if (row.bought) t.bought += 1;
  }
  return out;
}

export async function campaignResults(campaignId: string): Promise<CampaignResults> {
  return (await campaignResultsMany([campaignId])).get(campaignId)!;
}
