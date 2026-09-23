import { z } from "zod";
import { id, requiredText } from "@/lib/validation/common";

// Departments carry a single name (not one per language): they are internal labels an
// admin types, unlike the master lists in M04, which the schema gives three names.
export const departmentInput = z.object({
  name: requiredText(2, 100, "departments.errors.nameRequired", "departments.errors.nameTooLong"),
});

export const createDepartmentInput = departmentInput;
export const renameDepartmentInput = departmentInput.extend({ id });

export const setDepartmentStatusInput = z.object({
  id,
  status: z.enum(["ACTIVE", "INACTIVE"]),
});
