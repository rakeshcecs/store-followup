import { z } from "zod";
import { locales } from "@/i18n/config";
import { normalizeMobile } from "@/lib/mobile";
import { id } from "@/lib/validation/common";

// PIN policy, kept beside the rules themselves so the action file (which is a
// "use server" module and may only export async functions) can import them, and so
// tests can check the message files still name the same numbers.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// A PIN with a pattern is the first thing anyone tries, and four digits give only
// 10,000 of them. Blocked: all four digits the same, and the two runs.
const BLOCKED_PINS = new Set([
  ...Array.from({ length: 10 }, (_, digit) => String(digit).repeat(4)),
  "1234",
  "4321",
]);

// The form sends whatever the person typed; the schema stores the 10-digit form.
export const mobileField = z.preprocess(
  (value) => normalizeMobile(value) ?? value,
  z.string().regex(/^[6-9]\d{9}$/, "auth.errors.mobileInvalid"),
);

export const pinField = z
  .string()
  .regex(/^\d{4}$/, "auth.errors.pinDigits")
  .refine((pin) => !BLOCKED_PINS.has(pin), "auth.errors.pinTooSimple");

export const loginInput = z.object({
  mobile: mobileField,
  // Not pinField: an existing PIN is only ever checked against the hash, and refusing
  // to send "1234" here would tell the caller which PINs are worth guessing.
  pin: z.string().regex(/^\d{4}$/, "auth.errors.pinDigits"),
  // The login screen's language switcher writes a cookie before anyone is signed in;
  // this carries the same choice onto the user row (M18.02).
  language: z.enum(locales).optional(),
});

export const setPinInput = z
  .object({
    currentPin: z.string().optional(),
    pin: pinField,
    confirmPin: z.string(),
  })
  .refine((value) => value.pin === value.confirmPin, {
    message: "auth.errors.pinMismatch",
    path: ["confirmPin"],
  });

export const resetPinInput = z.object({
  userId: id,
  pin: pinField,
});

export type LoginInput = z.infer<typeof loginInput>;
export type SetPinInput = z.infer<typeof setPinInput>;
