import { z } from "zod";
import { isRealDay } from "./common";
import { emptyToUndefined, id } from "@/lib/validation/common";

// Kept here, not in src/lib/settings.ts: this file is parsed in the browser too, and
// settings.ts brings the database client with it.
export const DEFAULT_AI_DAILY_LIMIT = 100;
export const AI_DAILY_LIMIT_MAX = 1000;

// M20. What the phone sends to the AI, what the AI is allowed to answer, and what the
// admin can set. The answer schema is deliberately loose (nullable everything): the
// model's output is checked and trimmed in src/lib/ai/check.ts, never trusted as-is.

// The three screens with an "Ask AI to fill" button. The name is stored on the log row.
export const AI_SCREENS = ["visit", "followUp", "followUpResult"] as const;
export type AiScreen = (typeof AI_SCREENS)[number];

export const AI_NOTE_MAX = 2000;
export const AI_AUDIO_MAX_SECONDS = 60;

export const suggestFieldsInput = z.object({
  screen: z.enum(AI_SCREENS),
  customerId: id,
  text: z.string().trim().min(1, "ai.errors.empty").max(AI_NOTE_MAX, "ai.errors.tooLong"),
  // Set when the note was spoken: only the length is kept, never the audio.
  audioSeconds: z.number().int().min(0).max(AI_AUDIO_MAX_SECONDS).optional(),
});
export type SuggestFieldsInput = z.infer<typeof suggestFieldsInput>;

export const EXPECTED_PURCHASE = ["THIS_WEEK", "THIS_MONTH", "NEXT_MONTH", "NOT_SURE"] as const;
export const OUTCOMES = ["PURCHASED", "DECIDE_LATER", "NOT_INTERESTED"] as const;
export const RESULTS = ["WILL_VISIT", "CALL_LATER", "NOT_REACHABLE", "NOT_INTERESTED"] as const;
export const TIME_SLOTS = ["MORNING", "AFTERNOON", "EVENING"] as const;
export const METHODS = ["CALL", "WHATSAPP", "VISIT"] as const;
export const INTENTS = ["HOT", "WARM", "COLD"] as const;
export type ExpectedPurchase = (typeof EXPECTED_PURCHASE)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type FollowUpResult = (typeof RESULTS)[number];
export type TimeSlot = (typeof TIME_SLOTS)[number];
export type Method = (typeof METHODS)[number];
export type Intent = (typeof INTENTS)[number];

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

// The model's raw tool call. Field names are the form's own, so a suggestion maps
// straight onto the screen's state.
export const aiRawOutput = z.object({
  categoryIds: nullable(z.array(z.string())),
  expectedPurchase: nullable(z.enum(EXPECTED_PURCHASE)),
  remarks: nullable(z.string()),
  outcome: nullable(z.enum(OUTCOMES)),
  lostReasonId: nullable(z.string()),
  // Two slots, not one: "the customer comes Sunday, call him Saturday" has both, and a
  // small model fills two literal slots far more reliably than it applies "the call
  // comes first". The checker turns them into the form's one follow-up.
  contact: nullable(
    z.object({
      date: nullable(z.string()),
      timeSlot: nullable(z.enum(TIME_SLOTS)),
      method: nullable(z.enum(["CALL", "WHATSAPP"])),
      reason: nullable(z.string()),
    }),
  ),
  visit: nullable(
    z.object({
      date: nullable(z.string()),
      timeSlot: nullable(z.enum(TIME_SLOTS)),
    }),
  ),
  result: nullable(z.enum(RESULTS)),
  intent: nullable(z.enum(INTENTS)),
  confidence: nullable(z.record(z.string(), z.number())),
});
export type AiRawOutput = z.infer<typeof aiRawOutput>;

// What a screen saved in the end, sent back so the log can say whether the suggestion
// was accepted as it was (M20.07). Unknown keys are dropped by zod.
const isoDay = z.string().refine(isRealDay, "visits.errors.dueDateInvalid");
export const aiFinalValues = z.object({
  categoryIds: z.array(id).optional(),
  expectedPurchase: z.preprocess(emptyToUndefined, z.enum(EXPECTED_PURCHASE).optional()),
  remarks: z.preprocess(emptyToUndefined, z.string().optional()),
  outcome: z.preprocess(emptyToUndefined, z.enum(OUTCOMES).optional()),
  lostReasonId: z.preprocess(emptyToUndefined, z.string().optional()),
  followUp: z
    .object({
      date: isoDay,
      timeSlot: z.enum(TIME_SLOTS).optional(), // Update follow-up has no slot
      method: z.enum(METHODS).optional(),
      reason: z.preprocess(emptyToUndefined, z.string().optional()),
    })
    .optional(),
  result: z.preprocess(emptyToUndefined, z.enum(RESULTS).optional()),
  intent: z.preprocess(emptyToUndefined, z.enum(INTENTS).optional()),
});
export type AiFinalValues = z.infer<typeof aiFinalValues>;

export const recordAiOutcomeInput = z.object({
  suggestionId: id,
  finalValues: aiFinalValues,
});

// Settings → AI assistant. A ticked checkbox posts "on"; an unticked one posts nothing.
export const aiSettingsInput = z.object({
  enabled: z.preprocess((value) => value === "on" || value === true, z.boolean()),
  dailyLimit: z.coerce
    .number("aiSettings.errors.limit")
    .int("aiSettings.errors.limit")
    .min(1, "aiSettings.errors.limit")
    .max(AI_DAILY_LIMIT_MAX, "aiSettings.errors.limit"),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInput>;

// ---------- M21: questions about the data ----------

export const ASK_QUESTION_MAX = 500;

export const askInput = z.object({
  question: z
    .string()
    .trim()
    .min(1, "ask.errors.empty")
    .max(ASK_QUESTION_MAX, "ask.errors.tooLong"),
});
export type AskInput = z.infer<typeof askInput>;

export const markAnswerWrongInput = z.object({ questionId: id });

// What the answer screen draws: a table already in the reader's language and formats, so
// the browser only lays it out. Customer names carry the link to their profile.
export type AskTable = {
  key: string;
  title: string;
  note?: string; // "Showing 50 of 132"
  columns: { label: string; numeric: boolean }[];
  rows: { cells: string[]; href?: string }[];
};

// One line of the streamed answer (newline-delimited JSON from /api/ai/ask).
export type AskEvent =
  | { type: "tool"; name: string }
  | { type: "text"; delta: string }
  | { type: "reset" }
  | { type: "tables"; tables: AskTable[] }
  | { type: "done"; questionId: string }
  | { type: "error"; message: string; values?: Record<string, string | number> };
