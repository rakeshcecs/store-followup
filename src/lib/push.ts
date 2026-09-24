// Phone push (M14, Web Push with VAPID keys). The worker calls pushPending() after each
// reminder job and once a minute; it pushes every Notification row not pushed yet, in
// the reader's language, to each device they allowed notifications on.
import webpush from "web-push";
import type { Locale } from "@/i18n/config";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { renderNotifications } from "@/lib/notification-text";

// Older rows are not pushed any more: a reminder that arrives hours late (the worker was
// down) is noise, and the bell list still has it.
export const PUSH_WINDOW_MS = 60 * 60 * 1000;
const BATCH = 200;

export type PushKeys = { p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; link: string; tag: string };

let vapidReady: boolean | null = null;

// Without keys the app works as before: reminders stay in the bell list.
export function pushConfigured(): boolean {
  if (vapidReady !== null) return vapidReady;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return (vapidReady = false);
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:owner@example.com",
    publicKey,
    privateKey,
  );
  return (vapidReady = true);
}

// For tests: forget what was read from the environment.
export function resetPushConfig(): void {
  vapidReady = null;
}

// To every device of one person. A device the push service no longer knows (404/410:
// uninstalled, permission withdrawn) is removed, as the module prompt asks.
export async function sendPush(userId: string, message: PushMessage): Promise<number> {
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, keys: true },
  });
  let delivered = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as PushKeys },
        JSON.stringify(message),
        { TTL: 60 * 60 },
      );
      delivered += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.pushSubscription.deleteMany({ where: { id: sub.id } });
      } else {
        // One bad device must not stop the others, or the rest of the batch.
        logger.error("push.failed", error, { status });
      }
    }
  }
  return delivered;
}

// Pushes whatever is waiting. Each row is claimed (pushedAt set) before it is sent, so
// two workers, or a job that is retried, never push the same row twice.
export async function pushPending(now = new Date()): Promise<number> {
  if (!pushConfigured()) return 0;
  const waiting = await db.notification.findMany({
    where: { pushedAt: null, sentAt: { gte: new Date(now.getTime() - PUSH_WINDOW_MS) } },
    orderBy: { sentAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      userId: true,
      type: true,
      message: true,
      link: true,
      user: { select: { language: true } },
    },
  });

  const claimed: typeof waiting = [];
  for (const row of waiting) {
    const { count } = await db.notification.updateMany({
      where: { id: row.id, pushedAt: null },
      data: { pushedAt: now },
    });
    if (count === 1) claimed.push(row);
  }

  let delivered = 0;
  const byUser = Map.groupBy(claimed, (row) => row.userId);
  for (const [userId, rows] of byUser) {
    const texts = await renderNotifications(rows, rows[0]!.user.language as Locale);
    for (const row of rows) {
      const text = texts.get(row.id);
      if (!text) continue;
      delivered += await sendPush(userId, { ...text, tag: row.id });
    }
  }
  return delivered;
}
