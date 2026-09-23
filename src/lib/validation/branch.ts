import { z } from "zod";
import { ALL_BRANCHES } from "@/lib/permissions";
import { emptyToUndefined, id, optionalText, requiredText } from "@/lib/validation/common";

// 15-character GSTIN: 2-digit state code, 5 letters + 4 digits + 1 letter (PAN),
// entity number, a fixed "Z", then a check character.
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Store phone, not a customer mobile: landlines and formatting are allowed here.
const PHONE = /^[0-9+\-\s()]{6,20}$/;

export const branchInput = z.object({
  name: requiredText(2, 80, "branches.errors.nameRequired", "branches.errors.nameTooLong"),
  address: requiredText(
    3,
    255,
    "branches.errors.addressRequired",
    "branches.errors.addressTooLong",
  ),
  city: requiredText(2, 100, "branches.errors.cityRequired", "branches.errors.cityTooLong"),
  phone: z.string().trim().regex(PHONE, "branches.errors.phoneInvalid"),
  gstNumber: z.preprocess(
    (value) => (typeof value === "string" ? emptyToUndefined(value.toUpperCase()) : value),
    z.string().trim().regex(GSTIN, "branches.errors.gstInvalid").optional(),
  ),
  openingHours: optionalText(100, "branches.errors.openingHoursTooLong"),
});

export const createBranchInput = branchInput;

export const updateBranchInput = branchInput.extend({ id });

// Status only moves through setBranchStatus, which carries the deactivation rule.
export const setBranchStatusInput = z.object({
  id,
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export const setCurrentBranchInput = z.object({
  branchId: z.union([id, z.literal(ALL_BRANCHES)]),
});

export type BranchInput = z.infer<typeof branchInput>;
