// What the model is told (M20). Pure: the caller passes today's IST day, the lists and
// the note, so the same prompt comes out on the server and in tests.
//
// Privacy (module prompt): only the note, the customer's first name and the open
// enquiry's title go in — never a mobile number or an address.
import { addDays } from "@/lib/follow-up-dates";
import type { ToolDefinition } from "@/lib/ai/provider";
import type { Locale } from "@/i18n/config";
import {
  EXPECTED_PURCHASE,
  INTENTS,
  METHODS,
  OUTCOMES,
  RESULTS,
  TIME_SLOTS,
  type AiScreen,
} from "@/lib/validation/ai";

export type NamedOption = { id: string; nameEn: string; nameHi: string; nameGu: string };

export type PromptContext = {
  screen: AiScreen;
  storeName: string;
  today: string; // "2026-09-25", the IST calendar day
  festivals: { name: string; date: string }[]; // the next 90 days, "YYYY-MM-DD"
  categories: NamedOption[];
  reasons: NamedOption[];
  customerFirstName: string;
  enquiryTitle: string | null;
  language: Locale;
  text: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LANGUAGE_NAME: Record<Locale, string> = {
  en: "English (Indian staff; Hindi or Gujarati words in Latin letters are normal)",
  hi: "Hindi",
  gu: "Gujarati",
};

// "Saturday 26 Sep 2026 = 2026-09-26": the model reads the weekday off this line instead
// of working it out, which is where "next Sunday" used to go wrong.
export function dayLine(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const weekday = WEEKDAYS[date.getUTCDay()];
  return `${weekday} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} = ${day}`;
}

const SCREEN_FIELDS: Record<AiScreen, string> = {
  visit:
    "Record visit: categoryIds, expectedPurchase, remarks, outcome, lostReasonId (only with NOT_INTERESTED), contact and visit (only with DECIDE_LATER), intent. Leave result null.",
  followUp:
    "Set follow-up: contact (the call or message to make) and/or visit (the day the customer comes). Leave categoryIds empty and every other field null.",
  followUpResult:
    "Update follow-up (what happened after the call): result; with CALL_LATER fill contact (the day to call again); with WILL_VISIT fill visit (the day they come); lostReasonId (only with NOT_INTERESTED); remarks as a short note of what the customer said. Leave categoryIds empty and every other field null.",
};

const names = (option: NamedOption) =>
  [option.nameEn, option.nameHi, option.nameGu]
    .filter((n, i, all) => n.trim() && all.indexOf(n) === i)
    .join(" / ");

export function buildFillPrompt(ctx: PromptContext): { system: string; user: string } {
  const days = Array.from({ length: 21 }, (_, offset) => dayLine(addDays(ctx.today, offset)));
  const festivals =
    ctx.festivals.length > 0
      ? ctx.festivals.map((f) => `${f.name} = ${f.date}`).join("; ")
      : "none in the next 90 days";
  const system = [
    `You fill in a form for the staff of ${ctx.storeName}, a clothing store in India, from one note they wrote or spoke about a customer. Answer only by calling the tool fill_form.`,
    ``,
    `Today: ${dayLine(ctx.today)} (India). Coming days: ${days.join("; ")}.`,
    `Festivals: ${festivals}.`,
    ``,
    `Screen — ${SCREEN_FIELDS[ctx.screen]}`,
    ``,
    `Requirement categories (id = names): ${ctx.categories.map((c) => `${c.id} = ${names(c)}`).join("; ") || "none"}.`,
    `Not-interested reasons (id = names): ${ctx.reasons.map((r) => `${r.id} = ${names(r)}`).join("; ") || "none"}.`,
    ``,
    `Rules:`,
    `- Use only ids from the lists above. Pick every category the note supports; none fits → empty list.`,
    `- Dates are YYYY-MM-DD, today or later, taken from the day list. "next Sunday" / "Sunday" = the coming Sunday (today if today is Sunday and the note says today). "Saturday evening" = the coming Saturday, timeSlot EVENING. "10 din baad" / "after 10 days" = today + 10. "agle hafte" = next Monday. "agle mahine" = one month from today. "after <festival>" = the day after that festival; "before <festival>" = about a week before it.`,
    `- contact = a call or WhatsApp message the STAFF must make, exactly as the note asks ("call him Saturday evening" → contact.date = that Saturday, timeSlot EVENING, method CALL, reason = what the call is about). Null when the note asks for no call or message.`,
    `- visit = the day the CUSTOMER said they will come to the store ("will come Sunday with family" → visit.date = that Sunday). Null when no visit day is mentioned. Fill BOTH slots when the note has both; never move the call to the visit day.`,
    `- Time words: morning/subah/savar → MORNING, afternoon/dopahar → AFTERNOON, evening/shaam/sanj → EVENING; nothing said → EVENING.`,
    `- outcome (Record visit only): PURCHASED only if they bought today; NOT_INTERESTED only when they clearly will not buy; DECIDE_LATER whenever they will think it over, come back, or want a call or message — a note that plans any contact or visit is DECIDE_LATER; null only when the note says nothing about it. On Record visit, result is always null.`,
    `- Example (Record visit, today Friday 25 Sep 2026): "Customer ko wedding sherwani pasand aayi, Sunday family ke saath aayega, Saturday evening call karna" → categoryIds: the sherwani and wedding categories; outcome: DECIDE_LATER; contact: { date: 2026-09-26, timeSlot: EVENING, method: CALL, reason: "Confirm Sunday visit with family" }; visit: { date: 2026-09-27, timeSlot: EVENING }; intent: WARM; result: null.`,
    `- expectedPurchase: ${EXPECTED_PURCHASE.join(" | ")} from words like "is hafte", "next month", "shaadi December mein"; null when not said.`,
    `- remarks: the note tidied up (spelling, punctuation), same language and script the staff used, first person removed, no phone numbers, at most 400 characters. Never add facts that are not in the note.`,
    `- intent: HOT = keen, buying within days; WARM = interested, will come back; COLD = unlikely; null when unclear.`,
    `- result (Update follow-up screen): WILL_VISIT, CALL_LATER, NOT_REACHABLE (no answer / switched off / busy), NOT_INTERESTED.`,
    `- confidence: for every field you fill, 0 to 1; below 0.6 when you are guessing. Fields you leave null need no confidence.`,
    `- Allowed values — outcome: ${OUTCOMES.join(" | ")}; result: ${RESULTS.join(" | ")}; timeSlot: ${TIME_SLOTS.join(" | ")}; method: ${METHODS.join(" | ")}; intent: ${INTENTS.join(" | ")}.`,
  ].join("\n");

  const user = [
    `Customer first name: ${ctx.customerFirstName || "unknown"}.`,
    `Open enquiry: ${ctx.enquiryTitle ?? "none"}.`,
    `Staff language: ${LANGUAGE_NAME[ctx.language]}.`,
    `Note:`,
    ctx.text,
  ].join("\n");

  return { system, user };
}

// Strict JSON Schema: every property listed and required, null standing in for "not
// filled". OpenAI's strict mode rejects anything looser.
const nullableString = { type: ["string", "null"] };
const nullableEnum = (values: readonly string[]) => ({
  type: ["string", "null"],
  enum: [...values, null],
});
const CONTACT_METHODS = ["CALL", "WHATSAPP"] as const;
const CONFIDENCE_FIELDS = [
  "categoryIds",
  "expectedPurchase",
  "remarks",
  "outcome",
  "lostReasonId",
  "contact",
  "visit",
  "result",
  "intent",
] as const;

export const FILL_FORM_TOOL: ToolDefinition = {
  name: "fill_form",
  description: "Fill the store's form from the staff member's note about the customer.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: [...CONFIDENCE_FIELDS, "confidence"],
    properties: {
      categoryIds: { type: "array", items: { type: "string" } },
      expectedPurchase: nullableEnum(EXPECTED_PURCHASE),
      remarks: nullableString,
      outcome: nullableEnum(OUTCOMES),
      lostReasonId: nullableString,
      contact: {
        description:
          "A call or WhatsApp message the STAFF must make, if the note asks for one: its day, time of day, how, and what it is about.",
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["date", "timeSlot", "method", "reason"],
            properties: {
              date: nullableString,
              timeSlot: nullableEnum(TIME_SLOTS),
              method: nullableEnum(CONTACT_METHODS),
              reason: nullableString,
            },
          },
        ],
      },
      visit: {
        description: "The day the CUSTOMER said they will come to the store, if the note says so.",
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["date", "timeSlot"],
            properties: { date: nullableString, timeSlot: nullableEnum(TIME_SLOTS) },
          },
        ],
      },
      result: nullableEnum(RESULTS),
      intent: nullableEnum(INTENTS),
      confidence: {
        type: "object",
        additionalProperties: false,
        required: [...CONFIDENCE_FIELDS],
        properties: Object.fromEntries(
          CONFIDENCE_FIELDS.map((f) => [f, { type: ["number", "null"] }]),
        ),
      },
    },
  },
};

// The words the speech model is most likely to mishear in a clothing shop.
export function transcribePrompt(storeName: string, categories: NamedOption[]): string {
  const words = categories
    .map((c) => c.nameEn)
    .slice(0, 30)
    .join(", ");
  return `${storeName}. Indian clothing store: ${words}. Hinglish and Gujarati mixed with English are normal.`;
}
