import { cache } from "react";
import { db } from "@/lib/db";

// The bell list covers the last 30 days (M14.06); older rows stay in the table.
export const BELL_DAYS = 30;

export function bellSince(now: Date): Date {
  return new Date(now.getTime() - BELL_DAYS * 24 * 60 * 60 * 1000);
}

// The number on the bell: unread, within the list's 30 days, own rows only.
export const unreadCount = cache(async (userId: string): Promise<number> =>
  db.notification.count({
    where: { userId, readAt: null, sentAt: { gte: bellSince(new Date()) } },
  }),
);
