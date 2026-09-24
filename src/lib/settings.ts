// Store-wide settings the admin can change without a code change, in the `settings`
// table (key → JSON). Each one has a typed reader with a default, so a missing row
// behaves exactly like a fresh install.
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_REMINDER_TIMES,
  reminderTimesInput,
  type ReminderTimes,
} from "@/lib/validation/reminders";

export const SETTING = {
  // SOW Open point #1 ("Should bill amount be required?" — suggested: make it required);
  // M10.05 calls it optional. The client chose required by default, switchable by the
  // admin (Settings → Sales).
  // Colon, like audit names, so a key can never be mistaken for a message key.
  billAmountRequired: "sales:billAmountRequired",
  // M14: when the reminders and summaries go out (Settings → Reminders).
  reminderTimes: "reminders:times",
} as const;

export async function billAmountRequired(): Promise<boolean> {
  const row = await db.setting.findUnique({
    where: { key: SETTING.billAmountRequired },
    select: { value: true },
  });
  return typeof row?.value === "boolean" ? row.value : true;
}

// A missing or damaged row falls back to the defaults, so reminders keep going out.
export async function reminderTimes(): Promise<ReminderTimes> {
  const row = await db.setting.findUnique({
    where: { key: SETTING.reminderTimes },
    select: { value: true },
  });
  const parsed = reminderTimesInput.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_REMINDER_TIMES;
}

export async function setSetting(
  tx: Prisma.TransactionClient,
  key: string,
  value: Prisma.InputJsonValue,
  userId: string,
): Promise<void> {
  await tx.setting.upsert({
    where: { key },
    create: { key, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
}
