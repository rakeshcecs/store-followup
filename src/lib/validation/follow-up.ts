import { z } from "zod";
import { id } from "@/lib/validation/common";
// The follow-up fields: M07's rules, one copy.
import { followUpInput } from "@/lib/validation/visit";

// M08.07: a follow-up on its own, from the customer profile (the enquiry must be open).
export const setFollowUpInput = z.object({
  clientId: z.uuid(),
  customerId: id,
  followUp: followUpInput.omit({ clientId: true }),
});

export type SetFollowUpInput = z.infer<typeof setFollowUpInput>;
