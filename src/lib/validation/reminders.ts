import { z } from "zod";

// Settings → Reminders (M14). One store-wide set of times, in IST, "HH:MM" 24-hour —
// what <input type="time"> posts. Per-branch times were left out on purpose: the SOW
// asks for store times, and Branch.openingHours is free text nobody can schedule from.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "reminderSettings.errors.time");

export const reminderTimesInput = z
  .object({
    morningSummary: time,
    slotMorning: time,
    slotAfternoon: time,
    slotEvening: time,
    managerSummary: time,
  })
  // A slot reminder lists that slot's follow-ups, so the three must come in day order.
  // "HH:MM" strings sort the same way as the times they name.
  .refine((t) => t.slotMorning < t.slotAfternoon && t.slotAfternoon < t.slotEvening, {
    message: "reminderSettings.errors.slotOrder",
    path: ["slotAfternoon"],
  });

export type ReminderTimes = z.infer<typeof reminderTimesInput>;

// SOW Q&A #5 and decisions.md: 9:30 AM summary; slots 10:30 AM, 2 PM, 5:30 PM. The 8 PM
// manager summary is M14.04's.
export const DEFAULT_REMINDER_TIMES: ReminderTimes = {
  morningSummary: "09:30",
  slotMorning: "10:30",
  slotAfternoon: "14:00",
  slotEvening: "17:30",
  managerSummary: "20:00",
};
