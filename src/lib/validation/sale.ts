import { z } from "zod";
import { emptyToUndefined, id, optionalText, requiredText } from "@/lib/validation/common";

// M10. The same rules whether the sale comes with a visit (M07's draft) or on its own.

// SOW M10.01: required, up to 30 characters, saved in capitals with the spaces at both
// ends removed. The same normalising runs before the live duplicate check, so what is
// checked is exactly what would be saved.
export const billNumberField = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "visits.errors.billRequired")
  .max(30, "visits.errors.billTooLong");

// "2026-09-24" from <input type="date">. Not in the future — checked against today in
// the action, which knows "now" in IST.
export const billDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "visits.errors.billDateInvalid");

// Whole rupees (SOW 5.7). Whether it may be left out is a store setting, checked in the
// action (src/lib/settings.ts).
export const billAmountField = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number("visits.errors.billAmountInvalid")
    .int("visits.errors.billAmountInvalid")
    .min(0, "visits.errors.billAmountInvalid")
    .max(99_99_99_999, "visits.errors.billAmountInvalid")
    .optional(),
);

export const saleInput = z.object({
  clientId: z.uuid().optional(),
  billNumber: billNumberField,
  billDate: billDateField,
  billAmount: billAmountField,
  remarks: optionalText(250, "visits.errors.saleRemarksTooLong"),
});

// A sale on its own, from the profile's "Sale done" (the enquiry must be open), or from
// Update follow-up's "Customer already bought" (M09.07), which names the follow-up that
// the sale completes and carries the note written there.
export const recordSaleInput = z.object({
  clientId: z.uuid(),
  customerId: id,
  sale: saleInput,
  followUpId: id.optional(),
  followUpNote: optionalText(250, "followUpResult.errors.noteTooLong"),
});

// The live check while typing (M10.02, M10.03).
export const checkBillInput = z.object({ billNumber: billNumberField });

// M10.09: only a manager or admin, and always with a reason.
const reasonField = requiredText(
  1,
  255,
  "sales.errors.reasonRequired",
  "sales.errors.reasonTooLong",
);

export const updateSaleInput = z.object({
  id,
  billNumber: billNumberField,
  billDate: billDateField,
  billAmount: billAmountField,
  salespersonId: id,
  reason: reasonField,
});

export const cancelSaleInput = z.object({ id, reason: reasonField });

export type SaleInput = z.infer<typeof saleInput>;
