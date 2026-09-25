import { z } from "zod";
import { id } from "@/lib/validation/common";

// M16.03: the admin types the last four digits of the customer's mobile to confirm.
export const deleteCustomerDataInput = z.object({
  customerId: id,
  lastFour: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "privacy.errors.lastFourFormat"),
});

export type DeleteCustomerDataInput = z.infer<typeof deleteCustomerDataInput>;
