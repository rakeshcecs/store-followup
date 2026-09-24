// M08.01: the quick date choices on Set follow-up. Pure and free of the clock — the
// caller passes "today" as the IST calendar day ("2026-09-24", from isoDate), so the
// same answer comes out on the phone, on the server and in tests.

export const FOLLOW_UP_SHORTCUTS = ["TOMORROW", "SATURDAY", "NEXT_WEEK", "TEN_DAYS"] as const;
export type FollowUpShortcut = (typeof FOLLOW_UP_SHORTCUTS)[number];

// A calendar day as UTC midnight: the date arithmetic never meets a time zone.
function utcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDays(day: string, days: number): string {
  const date = utcDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function followUpShortcut(kind: FollowUpShortcut, today: string): string {
  const weekday = utcDay(today).getUTCDay(); // 0 = Sunday … 6 = Saturday
  switch (kind) {
    case "TOMORROW":
      return addDays(today, 1);
    // On a Saturday it is the same day; on a Sunday, the coming Saturday.
    case "SATURDAY":
      return addDays(today, (6 - weekday + 7) % 7);
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
