"use server";

import { safeAction } from "@/lib/safe-action";
import { recordVisitInput } from "@/lib/validation/visit";
import { requestWriteContext } from "@/lib/writes/context";
import { recordVisitCore } from "@/lib/writes/visit";

// M07. Every role records visits (SOW 3.1 "Add customer, visit, follow-up, sale: Yes"),
// so the action checks only that someone is signed in. The work is in
// src/lib/writes/visit.ts, shared with the offline sync (M19).
export const recordVisit = safeAction({
  name: "recordVisit",
  schema: recordVisitInput,
  auth: {},
  handler: async (input, { user }) => recordVisitCore(input, user, await requestWriteContext(user)),
});
