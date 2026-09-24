// M08.01 / M09.04–05: the quick date choices on Set follow-up and Update follow-up.
// Pure and free of the clock — the caller passes "today" as the IST calendar day
// ("2026-09-24", from isoDate), so the same answer comes out on the phone, on the
// server and in tests.

export type DateShortcut =
  "TOMORROW" | "IN_3_DAYS" | "SATURDAY" | "SUNDAY" | "NEXT_WEEK" | "TEN_DAYS";

// Set follow-up (M08.01).
export const FOLLOW_UP_SHORTCUTS = ["TOMORROW", "SATURDAY", "NEXT_WEEK", "TEN_DAYS"] as const;
export type FollowUpShortcut = (typeof FOLLOW_UP_SHORTCUTS)[number];
// Update follow-up: "Spoke, customer will visit" and "Asked to call later" (module prompt M09).
export const VISIT_DAY_SHORTCUTS = ["TOMORROW", "SUNDAY", "NEXT_WEEK"] as const;
export const CALL_AGAIN_SHORTCUTS = ["TOMORROW", "IN_3_DAYS", "NEXT_WEEK"] as const;

// A calendar day as UTC midnight: the date arithmetic never meets a time zone.
function utcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDays(day: string, days: number): string {
  const date = utcDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function followUpShortcut(kind: DateShortcut, today: string): string {
  const weekday = utcDay(today).getUTCDay(); // 0 = Sunday … 6 = Saturday
  switch (kind) {
    case "TOMORROW":
      return addDays(today, 1);
    case "IN_3_DAYS":
      return addDays(today, 3);
    // On a Saturday it is the same day; on a Sunday, the coming Saturday.
    case "SATURDAY":
      return addDays(today, (6 - weekday + 7) % 7);
    // Same rule for Sunday: on a Sunday it is today.
    case "SUNDAY":
      return addDays(today, (7 - weekday) % 7);
    // Next week = next Monday; on a Monday that is a week away.
    case "NEXT_WEEK":
      return addDays(today, (1 - weekday + 7) % 7 || 7);
    case "TEN_DAYS":
      return addDays(today, 10);
  }
}

// A calendar day to hand to formatDayDate(), which formats in IST: noon UTC is the same
// day in India, whatever the phone's own zone.
export function dayForDisplay(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}
