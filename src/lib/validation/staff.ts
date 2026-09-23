import { z } from "zod";
import { roles } from "@/lib/roles";
import { emptyToUndefined, id, requiredText } from "@/lib/validation/common";
import { mobileField } from "@/lib/validation/auth";

// A calendar date from a <input type="date">: "2026-09-23". Stored in a @db.Date column,
// so no time and no zone — the day is the day, in IST as everywhere else.
const isoDateField = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "staff.errors.joinedOnInvalid")
    .optional(),
);

export const staffInput = z.object({
  fullName: requiredText(2, 100, "staff.errors.nameRequired", "staff.errors.nameTooLong"),
  mobile: mobileField,
  role: z.enum(roles),
  homeBranchId: id,
  // "" from an untouched select means "no department", not an invalid id.
  departmentId: z.preprocess(emptyToUndefined, id.optional()),
  joinedOn: isoDateField,
});

export const createStaffInput = staffInput;
export const updateStaffInput = staffInput.extend({ id });

export const setStaffStatusInput = z.object({
  id,
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export type StaffInput = z.infer<typeof staffInput>;
