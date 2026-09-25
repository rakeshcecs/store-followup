import { z } from "zod";
import { isRealDay } from "./common";
import { normalizeMobile } from "@/lib/mobile";
import { emptyToUndefined, id, optionalText, requiredText } from "@/lib/validation/common";

// M05. Only a name and a mobile number are required (M05.06); everything else lives
// behind "Add more details" and may be left alone.

// Its own field rather than `mobileField` from validation/auth.ts: the rule is the same,
// but M05.03 spells the message out — "Enter a 10-digit mobile number." — and the search
// screen and this form must not disagree about it.
const mobileField = z.preprocess(
  (value) => normalizeMobile(value) ?? value,
  z.string().regex(/^[6-9]\d{9}$/, "customers.errors.mobileInvalid"),
);

// The form sends "on" for a ticked checkbox and nothing at all for an unticked one, so
// an absent value is a real "no", not a missing field. Consent is ticked by default
// (M05.08), but a person can untick it and that must survive the round trip.
const checkboxField = z.preprocess((value) => value === "on" || value === true, z.boolean());

// "2026-09-23" from <input type="date">, stored in a @db.Date column: no time, no zone.
const isoDateField = z.preprocess(
  emptyToUndefined,
  z.string().refine(isRealDay, "customers.errors.occasionDateInvalid").optional(),
);

// An alternate number is optional, but if one is given it has to be a real mobile:
// M05 searches it too, so a half-typed number would quietly never be found.
const altMobileField = z.preprocess(
  emptyToUndefined,
  z.union([mobileField, z.undefined()]).optional(),
);

// BR-01: one number, one customer. A second copy of the main number in the alternate box
// adds nothing and makes the customer look like two numbers; the action also refuses an
// alternate that is someone else's number.
const altDiffersFromMobile = (value: { mobile?: string; altMobile?: string }) =>
  !value.altMobile || value.altMobile !== value.mobile;
const ALT_SAME = { message: "customers.errors.altSameAsMobile", path: ["altMobile"] };

export const createCustomerInput = z
  .object({
    // Made on the phone, so an entry sent twice (a retry, the offline outbox) is one
    // customer (M19).
    clientId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    name: requiredText(1, 100, "customers.errors.nameRequired", "customers.errors.nameTooLong"),
    mobile: mobileField,
    // "" from an untouched chip group or select means "not chosen", not an invalid id.
    departmentId: z.preprocess(emptyToUndefined, id.optional()),
    assignedToId: id,
    altMobile: altMobileField,
    area: optionalText(60, "customers.errors.areaTooLong"), // SOW 5.3: Text (60)
    city: optionalText(60, "customers.errors.cityTooLong"), // Text (60)
    address: optionalText(250, "customers.errors.addressTooLong"), // Text (250)
    occasion: optionalText(100, "customers.errors.occasionTooLong"),
    occasionDate: isoDateField,
    consentGiven: checkboxField,
  })
  .refine(altDiffersFromMobile, ALT_SAME);

export type CreateCustomerInput = z.infer<typeof createCustomerInput>;

// M06 edit details. The form always posts every box it draws, so an empty optional box
// means "clear it", and the action stores null for it.
//
// Mobile is optional because a salesperson's form has no box for it — only a manager or
// an admin may change the number, and the action checks that again rather than trusting
// the form.
export const updateCustomerInput = z
  .object({
    id,
    name: requiredText(1, 100, "customers.errors.nameRequired", "customers.errors.nameTooLong"),
    mobile: z.preprocess(emptyToUndefined, z.union([mobileField, z.undefined()]).optional()),
    departmentId: z.preprocess(emptyToUndefined, id.optional()),
    altMobile: altMobileField,
    area: optionalText(60, "customers.errors.areaTooLong"), // SOW 5.3: Text (60)
    city: optionalText(60, "customers.errors.cityTooLong"), // Text (60)
    address: optionalText(250, "customers.errors.addressTooLong"), // Text (250)
    occasion: optionalText(100, "customers.errors.occasionTooLong"),
    occasionDate: isoDateField,
  })
  // Only when the form sent a number; a salesperson's form has none, and the action
  // compares with the stored number instead.
  .refine(altDiffersFromMobile, ALT_SAME);

export type UpdateCustomerInput = z.infer<typeof updateCustomerInput>;
