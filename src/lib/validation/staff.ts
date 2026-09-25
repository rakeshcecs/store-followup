import { z } from "zod";
import { isRealDay } from "./common";
import { locales } from "@/i18n/config";
import { roles } from "@/lib/roles";
import { emptyToUndefined, id, requiredText } from "@/lib/validation/common";
import { mobileField } from "@/lib/validation/auth";

// A branch list from the chips, sent as one comma-separated hidden input rather than a
// real multi-select: useActionForm reads the form with Object.fromEntries, which keeps
// only the last value of a repeated key, so a <select multiple> would silently lose all
// but one branch.
const idListField = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : (value ?? []),
  z.array(id),
);

// A calendar date from a <input type="date">: "2026-09-23". Stored in a @db.Date column,
// so no time and no zone — the day is the day, in IST as everywhere else.
const isoDateField = z.preprocess(
  emptyToUndefined,
  z.string().refine(isRealDay, "staff.errors.joinedOnInvalid").optional(),
);

export const staffInput = z.object({
  fullName: requiredText(2, 100, "staff.errors.nameRequired", "staff.errors.nameTooLong"),
  mobile: mobileField,
  role: z.enum(roles),
  homeBranchId: id,
  // "" from an untouched select means "no department", not an invalid id.
  departmentId: z.preprocess(emptyToUndefined, id.optional()),
  joinedOn: isoDateField,
  // Branches a manager covers besides their home branch (SOW: "Extra branches").
  // The action refuses these for anyone who is not a manager.
  extraBranchIds: idListField,
  language: z.enum(locales).default("en"),
});

export const createStaffInput = staffInput;
export const updateStaffInput = staffInput.extend({ id });

export const setStaffStatusInput = z.object({
  id,
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export type StaffInput = z.infer<typeof staffInput>;
