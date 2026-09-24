"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { PUSH_COOKIE } from "@/lib/push-device";
import { safeAction } from "@/lib/safe-action";

// M14: this device's push subscription, and the bell list's "read".

const subscribeInput = z.object({
  endpoint: z.string().url().max(500),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

// One row per device (the endpoint is unique). A phone that changes hands moves to the
// person now signed in on it.
export const subscribePush = safeAction({
  name: "subscribePush",
  schema: subscribeInput,
  auth: {},
  handler: async ({ endpoint, keys }, { user }) => {
    await db.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: user.id, endpoint, keys },
      update: { userId: user.id, keys },
    });
    (await cookies()).set(PUSH_COOKIE, endpoint, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return { saved: true };
  },
});

// M14: "opening it marks all as read". Only your own rows.
export const markAllRead = safeAction({
  name: "markAllRead",
  schema: z.object({}),
  auth: {},
  handler: async (_input, { user }) => {
    const { count } = await db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  },
});
