// The model's answer, checked (M20 step 3): unknown ids dropped, past and impossible
// dates dropped, text cut to the form's own limits, fields the screen does not have
// removed. Pure, so the twenty fixture notes in tests/ai can run it against the real
// API and the unit tests against hand-written answers.
import { AppError } from "@/lib/errors";
import { isRealDay } from "@/lib/validation/common";
import {
  aiRawOutput,
  type AiRawOutput,
  type AiScreen,
  type ExpectedPurchase,
  type FollowUpResult,
  type Intent,
  type Method,
  type Outcome,
  type TimeSlot,
} from "@/lib/validation/ai";

export type AiFollowUp = {
  date?: string; // "YYYY-MM-DD", today or later
  timeSlot: TimeSlot;
  method: Method;
  reason?: string;
};

// What a screen receives. Only the fields the AI filled are present; `check` names the
// ones it was unsure about (confidence below 0.6), which the form marks "Please check".
export type AiSuggestion = {
  categoryIds?: string[];
  expectedPurchase?: ExpectedPurchase;
  remarks?: string;
  outcome?: Outcome;
  lostReasonId?: string;
  followUp?: AiFollowUp;
  result?: FollowUpResult;
  intent?: Intent;
  check: string[];
};

export type CheckContext = {
  screen: AiScreen;
  today: string;
  categoryIds: ReadonlySet<string>;
  reasonIds: ReadonlySet<string>;
};

export const LOW_CONFIDENCE = 0.6;
const REMARKS_MAX = 500; // Visit.remarks
const NOTE_MAX = 250; // FollowUp.resultNote and FollowUp.reason

type Field = Exclude<keyof AiSuggestion, "check">;

const SCREEN_FIELDS: Record<AiScreen, readonly Field[]> = {
  visit: [
    "categoryIds",
    "expectedPurchase",
    "remarks",
    "outcome",
    "lostReasonId",
    "followUp",
    "intent",
  ],
  followUp: ["followUp"],
  followUpResult: ["result", "followUp", "lostReasonId", "remarks"],
};

const cut = (value: string | null | undefined, max: number): string | undefined => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
};

const validDay = (value: string | null | undefined, today: string) =>
  value && isRealDay(value) && value >= today ? value : undefined;

// The one follow-up the form has, from the two slots the model fills: a call or message
// the staff must make comes first; otherwise the day the customer said they would come.
function followUpOf(raw: AiRawOutput, today: string, noteMax: number): AiFollowUp | undefined {
  const contact = raw.contact;
  const contactDate = validDay(contact?.date, today);
  const reason = cut(contact?.reason, noteMax);
  if (contact && (contactDate || contact.timeSlot || contact.method || reason)) {
    return {
      date: contactDate,
      timeSlot: contact.timeSlot ?? "EVENING", // the prototype's default, as the form's own
      method: contact.method ?? "CALL",
      reason,
    };
  }
  const visitDate = validDay(raw.visit?.date, today);
  if (visitDate)
    return { date: visitDate, timeSlot: raw.visit?.timeSlot ?? "EVENING", method: "VISIT" };
  return undefined;
}

// The form's follow-up has no confidence of its own; take the slot it came from.
function followUpConfidence(raw: AiRawOutput): number | undefined {
  const contact = raw.confidence?.["contact"];
  const visit = raw.confidence?.["visit"];
  if (raw.contact) return contact ?? visit;
  return visit ?? contact;
}

export function checkSuggestion(output: unknown, ctx: CheckContext): AiSuggestion {
  const parsed = aiRawOutput.safeParse(output);
  if (!parsed.success) throw new AppError("RULE", { message: "ai.errors.failed" });
  const raw = parsed.data;

  const all: Omit<AiSuggestion, "check"> = {};
  const categoryIds = (raw.categoryIds ?? []).filter((id) => ctx.categoryIds.has(id));
  if (categoryIds.length > 0) all.categoryIds = [...new Set(categoryIds)];
  if (raw.expectedPurchase) all.expectedPurchase = raw.expectedPurchase;
  if (raw.outcome) all.outcome = raw.outcome;
  if (raw.result) all.result = raw.result;
  if (raw.intent) all.intent = raw.intent;

  // A reason only makes sense with "not interested", on either screen.
  const notInterested = raw.outcome === "NOT_INTERESTED" || raw.result === "NOT_INTERESTED";
  if (notInterested && raw.lostReasonId && ctx.reasonIds.has(raw.lostReasonId)) {
    all.lostReasonId = raw.lostReasonId;
  }

  const remarks = cut(raw.remarks, ctx.screen === "visit" ? REMARKS_MAX : NOTE_MAX);
  if (remarks) all.remarks = remarks;

  // On Record visit a follow-up belongs to "decide later" only; on Update follow-up the
  // date is the next day to act, and only when there is a next time.
  const followUp = followUpOf(raw, ctx.today, NOTE_MAX);
  const wantsFollowUp =
    ctx.screen === "followUp" ||
    (ctx.screen === "visit" &&
      (raw.outcome === "DECIDE_LATER" || raw.outcome === null || raw.outcome === undefined)) ||
    (ctx.screen === "followUpResult" &&
      (raw.result === "WILL_VISIT" || raw.result === "CALL_LATER"));
  if (followUp && wantsFollowUp) all.followUp = followUp;
  // The model sometimes plans the follow-up and still leaves the outcome open; on Record
  // visit a planned follow-up can only mean "will decide later" (BR-04).
  if (ctx.screen === "visit" && !all.outcome && all.followUp) all.outcome = "DECIDE_LATER";

  const suggestion: AiSuggestion = { check: [] };
  for (const field of SCREEN_FIELDS[ctx.screen]) {
    const value = all[field];
    if (value === undefined) continue;
    (suggestion as Record<string, unknown>)[field] = value;
    const confidence = field === "followUp" ? followUpConfidence(raw) : raw.confidence?.[field];
    if (typeof confidence === "number" && confidence < LOW_CONFIDENCE) suggestion.check.push(field);
  }
  return suggestion;
}

// Nothing usable came back: the form shows "AI could not help this time".
export function isEmptySuggestion(suggestion: AiSuggestion): boolean {
  return Object.keys(suggestion).every((key) => key === "check");
}

// M20.07 "accepted": every field the AI filled was saved unchanged. Fields the AI left
// alone do not count either way; an empty suggestion is never "accepted".
export function acceptedAsSuggested(
  suggestion: AiSuggestion,
  finalValues: Record<string, unknown>,
): boolean {
  const fields = (Object.keys(suggestion) as (keyof AiSuggestion)[]).filter((k) => k !== "check");
  if (fields.length === 0) return false;
  return fields.every((field) => same(suggestion[field], finalValues[field]));
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const followUp = a as AiFollowUp;
    const saved = b as Record<string, unknown>;
    // The reason is free text the person often tidies; the plan (day, slot, method) is
    // what "accepted" means here.
    return (
      (followUp.date === undefined || followUp.date === saved["date"]) &&
      (saved["timeSlot"] === undefined || followUp.timeSlot === saved["timeSlot"]) &&
      (saved["method"] === undefined || followUp.method === saved["method"])
    );
  }
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return a === b;
}
