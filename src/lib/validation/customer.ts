import { z } from "zod";
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
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "customers.errors.occasionDateInvalid")
    .optional(),
);

// An alternate number is optional, but if one is given it has to be a real mobile:
// M05 searches it too, so a half-typed number would quietly never be found.
const altMobileField = z.preprocess(
  emptyToUndefined,
  z.union([mobileField, z.undefined()]).optional(),
);

export const createCustomerInput = z.object({
  name: requiredText(1, 100, "customers.errors.nameRequired", "customers.errors.nameTooLong"),
  mobile: mobileField,
  // "" from an untouched chip group or select means "not chosen", not an invalid id.
  departmentId: z.preprocess(emptyToUndefined, id.optional()),
  assignedToId: id,
  altMobile: altMobileField,
  area: optionalText(100, "customers.errors.areaTooLong"),
  city: optionalText(100, "customers.errors.cityTooLong"),
  address: optionalText(255, "customers.errors.addressTooLong"),
  occasion: optionalText(100, "customers.errors.occasionTooLong"),
  occasionDate: isoDateField,
  consentGiven: checkboxField,
});

export type CreateCustomerInput = z.infer<typeof createCustomerInput>;
