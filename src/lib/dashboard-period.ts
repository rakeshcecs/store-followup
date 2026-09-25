// M12's period: which IST calendar days the Store overview covers. No database here, so
// the client's period picker can use the same list and rules as the server.
import { z } from "zod";
import { isRealDay } from "@/lib/validation/common";
import { addDays, daysBetween } from "@/lib/follow-up-dates";

export const PERIODS = ["today", "yesterday", "week", "month", "custom"] as const;
export type Period = (typeof PERIODS)[number];
export type DayRange = { from: string; to: string };

// A custom range longer than this is refused (falls back to Today): SOW M13.04 sizes
// the reports for 12 months, and the dashboard is held to the same data.
export const CUSTOM_MAX_DAYS = 366;

const day = z.string().refine(isRealDay);
const periodParams = z.object({
  period: z.enum(PERIODS).catch("today"),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
});

// Monday is the first day of the week in India's shops (and ISO 8601).
function monday(today: string): string {
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -((weekday + 6) % 7));
}

// The period from the address bar. Anything unusable — an unknown word, half a custom
// range, from after to, a year and more — quietly becomes Today rather than an error.
export function parsePeriod(
  params: Record<string, string | string[] | undefined>,
  today: string,
): { period: Period; range: DayRange } {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const input = periodParams.parse({
    period: first(params["period"]),
    from: first(params["from"]),
    to: first(params["to"]),
  });

  switch (input.period) {
    case "yesterday": {
      const d = addDays(today, -1);
      return { period: "yesterday", range: { from: d, to: d } };
    }
    case "week":
      return { period: "week", range: { from: monday(today), to: today } };
    case "month":
      return { period: "month", range: { from: `${today.slice(0, 8)}01`, to: today } };
    case "custom": {
      const { from, to } = input;
      if (from && to && from <= to && daysBetween(from, to) < CUSTOM_MAX_DAYS) {
        return { period: "custom", range: { from, to } };
      }
      return { period: "today", range: { from: today, to: today } };
    }
    default:
      return { period: "today", range: { from: today, to: today } };
  }
}

// For @db.Date columns.
// (UTC midnight, as calendarDay() in src/lib/follow-ups.ts — not imported, so this file
// stays free of server code for the client's picker.)
export function dateWhere(range: DayRange): { gte: Date; lte: Date } {
  const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);
  return { gte: utc(range.from), lte: utc(range.to) };
}

// For instants: from IST midnight at the start to IST midnight after the end.
export function instantWhere(range: DayRange): { gte: Date; lt: Date } {
  return {
    gte: new Date(`${range.from}T00:00:00.000+05:30`),
    lt: new Date(`${addDays(range.to, 1)}T00:00:00.000+05:30`),
  };
}
