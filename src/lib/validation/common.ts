// Shared zod pieces for client forms and Server Actions.
//
// Every message is a next-intl key, never English: the same schema runs in the browser
// (to show all field errors at once) and on the server, so a literal here would be
// hard-coded UI text.
import { z } from "zod";

// A form sends "" for an untouched optional input; that means "not given", not "empty".
export const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export function requiredText(min: number, max: number, requiredKey: string, tooLongKey: string) {
  return z.string().trim().min(min, requiredKey).max(max, tooLongKey);
}

export function optionalText(max: number, tooLongKey: string) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(max, tooLongKey).optional());
}

// "2026-09-23" — the shape <input type="date"> sends — and a day that exists. The shape
// alone let "2026-02-30" through (saved as 2 March) and "2026-13-01" (an Invalid Date that
// crashed the save or the screen).
export function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Prisma cuids. Kept as a plain bounded string so a change of id format never
// silently rejects existing rows.
export const id = z.string().trim().min(1).max(40);
