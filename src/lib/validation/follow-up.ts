import { z } from "zod";
import { isRealDay } from "./common";
import { id, optionalText } from "@/lib/validation/common";
// The follow-up fields: M07's rules, one copy.
import { followUpInput } from "@/lib/validation/visit";

// M08.07: a follow-up on its own, from the customer profile (the enquiry must be open).
export const setFollowUpInput = z.object({
  clientId: z.uuid(),
  customerId: id,
  followUp: followUpInput.omit({ clientId: true }),
});

// M09.09: what the customer said, on any result.
export const resultNote = optionalText(250, "followUpResult.errors.noteTooLong");

const nextDate = z
  .string("followUps.errors.pickDate")
  .refine(isRealDay, "followUps.errors.pickDate");

// M09. The result decides what else must come with it, so the API cannot take "will
// visit" without the day or "not interested" without a reason. "Customer already
// bought" is not here: it is saved with its sale (M09.07, recordSale).
const resultBase = z.object({
  id, // the follow-up
  // For the next follow-up, so a retry cannot make two (and M19 can sync it offline).
  clientId: z.uuid(),
  note: resultNote,
});

export const recordFollowUpResultInput = z.discriminatedUnion("result", [
  resultBase.extend({ result: z.literal("WILL_VISIT"), nextDate }),
  resultBase.extend({ result: z.literal("CALL_LATER"), nextDate }),
  resultBase.extend({ result: z.literal("NOT_REACHABLE") }),
  resultBase.extend({
    result: z.literal("NOT_INTERESTED"),
    lostReasonId: z
      .string("visits.errors.reasonRequired")
      .trim()
      .min(1, "visits.errors.reasonRequired"),
  }),
]);

export type SetFollowUpInput = z.infer<typeof setFollowUpInput>;
export type RecordFollowUpResultInput = z.infer<typeof recordFollowUpResultInput>;
