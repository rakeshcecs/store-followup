import { z } from "zod";
import { emptyToUndefined, id, optionalText } from "@/lib/validation/common";
// The sale that comes with a "Yes, bought something" visit: M10's rules, one copy.
import { saleInput } from "@/lib/validation/sale";

// M07. The outcome decides what else must come with the visit, and the schema is a union
// on it so the API itself cannot accept a bought visit without its bill (BR-03), a
// "decide later" visit without its follow-up (BR-04), or "not interested" without a
// reason (BR-05). The dates are checked against today in the action, which knows "now".

// "2026-09-24" from <input type="date">: no time, no zone.
const isoDay = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);

const EXPECTED = ["THIS_WEEK", "THIS_MONTH", "NEXT_MONTH", "NOT_SURE"] as const;

const visitBase = z.object({
  // Made on the phone, so a retry or a double tap cannot record the visit twice (and so
  // M19 can sync a visit taken offline).
  clientId: z.uuid(),
  customerId: id,
  categoryIds: z.array(id).min(1, "visits.errors.categoryRequired").max(30),
  expectedPurchase: z.preprocess(emptyToUndefined, z.enum(EXPECTED).optional()),
  remarks: optionalText(500, "visits.errors.remarksTooLong"),
});

// The follow-up that comes with a "No, will decide later" visit (M08 draws the screen).
export const followUpInput = z.object({
  clientId: z.uuid().optional(),
  dueDate: isoDay("visits.errors.dueDateInvalid"),
  timeSlot: z.enum(["MORNING", "AFTERNOON", "EVENING"], "visits.errors.timeSlotRequired"),
  method: z.enum(["CALL", "WHATSAPP", "VISIT"], "visits.errors.methodRequired"),
  reason: optionalText(250, "visits.errors.followUpReasonTooLong"),
});

export const recordVisitInput = z.discriminatedUnion("outcome", [
  visitBase.extend({ outcome: z.literal("PURCHASED"), sale: saleInput }),
  visitBase.extend({ outcome: z.literal("DECIDE_LATER"), followUp: followUpInput }),
  visitBase.extend({
    outcome: z.literal("NOT_INTERESTED"),
    lostReasonId: z
      .string("visits.errors.reasonRequired")
      .trim()
      .min(1, "visits.errors.reasonRequired"),
  }),
]);

export type RecordVisitInput = z.infer<typeof recordVisitInput>;
export type FollowUpInput = z.infer<typeof followUpInput>;
