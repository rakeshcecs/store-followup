"use server";

import { getTranslations } from "next-intl/server";
import { markAnswerWrongCore } from "@/lib/ai/ask";
import { aiProvider } from "@/lib/ai/provider";
import { recordAiOutcomeCore, suggestFieldsCore } from "@/lib/ai/suggest";
import { getCurrentBranch } from "@/lib/current-branch";
import { safeAction } from "@/lib/safe-action";
import {
  markAnswerWrongInput,
  recordAiOutcomeInput,
  suggestFieldsInput,
} from "@/lib/validation/ai";

// M20. Every role records visits and follow-ups, so every role may ask the AI (the admin's
// switch and the daily limit are checked inside). Online only: this never goes through the
// offline outbox, because the answer is needed now or not at all.
export const suggestFields = safeAction({
  name: "suggestFields",
  schema: suggestFieldsInput,
  auth: {},
  handler: async (input, { user }) => {
    const tApp = await getTranslations("app");
    return suggestFieldsCore(input, user, {
      provider: aiProvider(),
      now: new Date(),
      branch: await getCurrentBranch(user),
      storeName: tApp("storeName"),
    });
  },
});

export const recordAiOutcome = safeAction({
  name: "recordAiOutcome",
  schema: recordAiOutcomeInput,
  auth: {},
  handler: async (input, { user }) =>
    recordAiOutcomeCore(input.suggestionId, input.finalValues, user),
});

// M21.06 "Was this wrong?" — marks the person's own answer for checking.
export const markAnswerWrong = safeAction({
  name: "markAnswerWrong",
  schema: markAnswerWrongInput,
  auth: {},
  handler: async (input, { user }) => markAnswerWrongCore(input.questionId, user),
});
