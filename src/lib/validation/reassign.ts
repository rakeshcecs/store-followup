import { z } from "zod";
import { id } from "@/lib/validation/common";

// The most one click may move: a leaving salesperson's whole book fits comfortably, and a
// request can never grow into a transaction that locks half the customer table.
export const REASSIGN_MAX = 500;

// M15: move customers (with their pending follow-ups) from one person to another.
// `deactivate` is the staff-exit path (M15.02): move everything, then mark them inactive.
export const reassignInput = z
  .object({
    fromId: id,
    toId: id,
    customerIds: z.array(id).min(1, "reassign.errors.pickCustomers").max(REASSIGN_MAX),
    deactivate: z.boolean().default(false),
  })
  .refine((input) => input.fromId !== input.toId, {
    message: "reassign.errors.samePerson",
    path: ["toId"],
  });

export type ReassignInput = z.infer<typeof reassignInput>;
