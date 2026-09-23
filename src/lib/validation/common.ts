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

// Prisma cuids. Kept as a plain bounded string so a change of id format never
// silently rejects existing rows.
export const id = z.string().trim().min(1).max(40);
