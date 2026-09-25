"use server";

import { safeAction } from "@/lib/safe-action";
import { recordFollowUpResultInput, setFollowUpInput } from "@/lib/validation/follow-up";
import { requestWriteContext } from "@/lib/writes/context";
import { recordFollowUpResultCore, setFollowUpCore } from "@/lib/writes/follow-up";

// M08 and M09. Open to every role (SOW 3.1); the work is in src/lib/writes/follow-up.ts,
// shared with the offline sync (M19).

export const setFollowUp = safeAction({
  name: "setFollowUp",
  schema: setFollowUpInput,
  auth: {},
  handler: async (input, { user }) => setFollowUpCore(input, user, await requestWriteContext(user)),
});

export const recordFollowUpResult = safeAction({
  name: "recordFollowUpResult",
  schema: recordFollowUpResultInput,
  auth: {},
  handler: async (input, { user }) =>
    recordFollowUpResultCore(input, user, await requestWriteContext(user)),
});
