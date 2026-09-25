// Turns Notification rows into what a person reads, in their own language (M14). Rows
// keep ids and numbers only ("summary-morning:2026-09-24:5:2") — the same rule as
// TimelineEvent titles — so the bell list and the phone push, which the worker sends
// with no request and no next-intl provider, both come through here.
import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/config";
import { db } from "@/lib/db";
import { dayForDisplay } from "@/lib/follow-up-dates";
import { formatDate, formatList } from "@/lib/format";
import { NOTIFICATION } from "@/lib/reminders";

export type NotificationRow = { id: string; type: string; message: string; link: string | null };
export type RenderedNotification = { title: string; body: string; link: string };

async function translator(locale: Locale) {
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages, namespace: "notifications" });
}

const parts = (row: NotificationRow) => row.message.split(":");
const toNumber = (value: string | undefined) => Number(value ?? 0) || 0;

// The names behind the ids, looked up in one query per kind.
async function lookups(rows: NotificationRow[]) {
  const userIds = new Set<string>();
  const customerIds = new Set<string>();
  const followUpIds = new Set<string>();
  const branchIds = new Set<string>();
  const campaignIds = new Set<string>();
  for (const row of rows) {
    const p = parts(row);
    if (row.type === "campaign-done" && p[1]) campaignIds.add(p[1]);
    if (row.type === "user-locked" && p[1]) userIds.add(p[1]);
    if ((row.type === "followup-missed" || row.type.startsWith("whatsapp-")) && p[1])
      customerIds.add(p[1]);
    if (row.type === NOTIFICATION.slot)
      (p[4] ?? "")
        .split(",")
        .filter(Boolean)
        .forEach((id) => followUpIds.add(id));
    if (row.type === NOTIFICATION.manager && p[2] && p[2] !== "all") branchIds.add(p[2]);
  }
  const [users, customers, followUps, branches, campaigns] = await Promise.all([
    userIds.size
      ? db.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, fullName: true },
        })
      : [],
    customerIds.size
      ? db.customer.findMany({
          where: { id: { in: [...customerIds] } },
          select: { id: true, name: true },
        })
      : [],
    followUpIds.size
      ? // branch-scope-exempt: the ids come from the reader's own notification rows.
        db.followUp.findMany({
          where: { id: { in: [...followUpIds] } },
          select: { id: true, customer: { select: { name: true } } },
        })
      : [],
    branchIds.size
      ? db.branch.findMany({
          where: { id: { in: [...branchIds] } },
          select: { id: true, name: true },
        })
      : [],
    campaignIds.size
      ? // branch-scope-exempt: the ids come from the reader's own notification rows.
        db.campaign.findMany({
          where: { id: { in: [...campaignIds] } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  return {
    user: new Map(users.map((u) => [u.id, u.fullName])),
    customer: new Map(customers.map((c) => [c.id, c.name])),
    followUp: new Map(followUps.map((f) => [f.id, f.customer.name])),
    branch: new Map(branches.map((b) => [b.id, b.name])),
    campaign: new Map(campaigns.map((c) => [c.id, c.name])),
  };
}

// Several rows at once, all read by one person (the bell list, or one push batch).
export async function renderNotifications(
  rows: NotificationRow[],
  locale: Locale,
): Promise<Map<string, RenderedNotification>> {
  const t = await translator(locale);
  const names = await lookups(rows);
  const out = new Map<string, RenderedNotification>();

  for (const row of rows) {
    const p = parts(row);
    const link = row.link ?? "/";
    const someone = t("someone");
    switch (row.type) {
      case NOTIFICATION.morning:
        out.set(row.id, {
          title: t("morning.title"),
          body: t("morning.body", { today: toNumber(p[2]), overdue: toNumber(p[3]) }),
          link,
        });
        break;
      case NOTIFICATION.slot: {
        // "reminder-slot:<date>:<slot>:<total>:<id1>,<id2>"
        const total = toNumber(p[3]);
        const shown = (p[4] ?? "")
          .split(",")
          .filter(Boolean)
          .map((id) => names.followUp.get(id) ?? someone);
        const rest = total - shown.length;
        out.set(row.id, {
          title: t(
            `slot.${p[2] === "MORNING" ? "MORNING" : p[2] === "AFTERNOON" ? "AFTERNOON" : "EVENING"}`,
          ),
          body:
            rest > 0
              ? t("slot.more", { names: shown.join(", "), count: rest })
              : formatList(shown, locale),
          link,
        });
        break;
      }
      case NOTIFICATION.manager: {
        // "summary-manager:<date>:<branchId|all>:<visits>:<sales>:<done>:<due>:<overdue>"
        const branch = p[2] === "all" ? null : (names.branch.get(p[2] ?? "") ?? someone);
        out.set(row.id, {
          title: branch ? t("manager.title", { branch }) : t("manager.titleAll"),
          body: t("manager.body", {
            visits: toNumber(p[3]),
            sales: toNumber(p[4]),
            done: toNumber(p[5]),
            due: toNumber(p[6]),
            overdue: toNumber(p[7]),
          }),
          link,
        });
        break;
      }
      case "user-locked":
        out.set(row.id, {
          title: t("locked.title"),
          body: t("locked.body", { name: names.user.get(p[1] ?? "") ?? someone }),
          link,
        });
        break;
      case "followup-missed":
        out.set(row.id, {
          title: t("missed.title"),
          body: t("missed.body", { name: names.customer.get(p[1] ?? "") ?? someone }),
          link,
        });
        break;
      // M22: "whatsapp-in:<customerId>", "whatsapp-stop:<customerId>".
      case "whatsapp-in":
      case "whatsapp-stop": {
        const key = row.type === "whatsapp-in" ? "whatsappIn" : "whatsappStop";
        const name = names.customer.get(p[1] ?? "") ?? someone;
        out.set(row.id, { title: t(`${key}.title`, { name }), body: t(`${key}.body`), link });
        break;
      }
      // M23: "campaign-done:<campaignId>:<queued>:<skipped>".
      case "campaign-done":
        out.set(row.id, {
          title: t("campaignDone.title", { name: names.campaign.get(p[1] ?? "") ?? "" }),
          body: t("campaignDone.body", { queued: toNumber(p[2]), skipped: toNumber(p[3]) }),
          link,
        });
        break;
      case "backup-failed":
        // "backup-failed:<date>"
        out.set(row.id, {
          title: t("backupFailed.title"),
          body: t("backupFailed.body", {
            date: /^\d{4}-\d{2}-\d{2}$/.test(p[1] ?? "")
              ? formatDate(dayForDisplay(p[1]!), locale)
              : "",
          }),
          link,
        });
        break;
      default:
        out.set(row.id, { title: t("title"), body: "", link });
    }
  }
  return out;
}
