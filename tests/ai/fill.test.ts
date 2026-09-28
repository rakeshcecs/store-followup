import "dotenv/config";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import notes from "./fixtures/notes.json";
import { checkSuggestion, type AiSuggestion } from "@/lib/ai/check";
import { buildFillPrompt, FILL_FORM_TOOL, type NamedOption } from "@/lib/ai/prompt";
import { AI_FILL_TIMEOUT_MS, aiProvider } from "@/lib/ai/provider";
import { prefillFestivals } from "@/lib/festivals";
import { addDays, followUpShortcut, type DateShortcut } from "@/lib/follow-up-dates";
import { isoDate } from "@/lib/format";
import type { AiScreen } from "@/lib/validation/ai";
import type { Locale } from "@/i18n/config";

// M20 "Done when": twenty notes in English, Hindi, Gujarati and mixed speech, run against
// the REAL model (`npm run test:ai`, needs OPENAI_API_KEY; not part of `npm test`). Every
// answer must pass the checker, and the fields a shopkeeper would read off the note must
// come out right. No database: the lists are the seed's.

const CATEGORIES: NamedOption[] = [
  {
    id: "seed-cat-wedding",
    nameEn: "Wedding Clothes",
    nameHi: "शादी के कपड़े",
    nameGu: "લગ્નના કપડાં",
  },
  { id: "seed-cat-sherwani", nameEn: "Sherwani", nameHi: "शेरवानी", nameGu: "શેરવાની" },
  { id: "seed-cat-suit", nameEn: "Suit", nameHi: "सूट", nameGu: "સૂટ" },
  { id: "seed-cat-saree", nameEn: "Saree", nameHi: "साड़ी", nameGu: "સાડી" },
  {
    id: "seed-cat-casual",
    nameEn: "Casual Wear",
    nameHi: "कैज़ुअल कपड़े",
    nameGu: "કેઝ્યુઅલ કપડાં",
  },
  {
    id: "seed-cat-festival",
    nameEn: "Festival Collection",
    nameHi: "त्योहार कलेक्शन",
    nameGu: "તહેવાર કલેક્શન",
  },
  {
    id: "seed-cat-family",
    nameEn: "Family Shopping",
    nameHi: "परिवार की खरीदारी",
    nameGu: "પરિવારની ખરીદી",
  },
  { id: "seed-cat-bulk", nameEn: "Bulk Purchase", nameHi: "थोक खरीद", nameGu: "જથ્થાબંધ ખરીદી" },
  { id: "seed-cat-other", nameEn: "Other", nameHi: "अन्य", nameGu: "અન્ય" },
];
const REASONS: NamedOption[] = [
  { id: "seed-lost-price", nameEn: "Price", nameHi: "कीमत", nameGu: "કિંમત" },
  {
    id: "seed-lost-design",
    nameEn: "Design not available",
    nameHi: "डिज़ाइन उपलब्ध नहीं",
    nameGu: "ડિઝાઇન ઉપલબ્ધ નથી",
  },
  {
    id: "seed-lost-size",
    nameEn: "Size not available",
    nameHi: "साइज़ उपलब्ध नहीं",
    nameGu: "સાઇઝ ઉપલબ્ધ નથી",
  },
  {
    id: "seed-lost-elsewhere",
    nameEn: "Bought elsewhere",
    nameHi: "कहीं और से खरीदा",
    nameGu: "બીજે ક્યાંકથી ખરીદ્યું",
  },
  { id: "seed-lost-other", nameEn: "Other", nameHi: "अन्य", nameGu: "અન્ય" },
];

type DateSpec =
  | { shortcut: DateShortcut }
  | { daysFromToday: number }
  | { weekday: number } // 0 = Sunday … 6 = Saturday, the coming one
  | { festival: string; plus: number };

type Fixture = {
  id: string;
  screen: AiScreen;
  language: Locale;
  text: string;
  expect: {
    categoryIds?: string[]; // must all be present
    outcome?: string | string[];
    result?: string | string[];
    lostReasonId?: string | string[];
    expectedPurchase?: string | string[];
    intent?: string | string[];
    followUp?: { date?: DateSpec; timeSlot?: string; method?: string };
    remarksScript?: "devanagari" | "gujarati";
  };
};

const today = isoDate(new Date());
// The same calendar the server would send: the pre-filled festivals within 90 days.
const festivals = prefillFestivals(today)
  .filter((f) => f.date >= today && f.date <= addDays(today, 90))
  .map((f) => ({
    key: f.key,
    name: en.festivals.names[f.key as keyof typeof en.festivals.names],
    date: f.date,
  }));

function resolveDate(spec: DateSpec): string | null {
  if ("shortcut" in spec) return followUpShortcut(spec.shortcut, today);
  if ("daysFromToday" in spec) return addDays(today, spec.daysFromToday);
  if ("weekday" in spec) {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    return addDays(today, (spec.weekday - weekday + 7) % 7 || 7);
  }
  const festival = festivals.find((f) => f.key === spec.festival);
  return festival ? addDays(festival.date, spec.plus) : null; // null: not in the window now
}

const oneOf = (value: unknown, expected: string | string[]) =>
  Array.isArray(expected) ? expected.includes(value as string) : value === expected;

const SCRIPT: Record<"devanagari" | "gujarati", RegExp> = {
  devanagari: /[\u0900-\u097F]/,
  gujarati: /[\u0A80-\u0AFF]/,
};

async function fill(fixture: Fixture): Promise<{ suggestion: AiSuggestion; ms: number }> {
  const prompt = buildFillPrompt({
    screen: fixture.screen,
    storeName: en.app.storeName,
    today,
    festivals: festivals.map(({ name, date }) => ({ name, date })),
    categories: CATEGORIES,
    reasons: REASONS,
    customerFirstName: "Ramesh",
    enquiryTitle: null,
    language: fixture.language,
    text: fixture.text,
  });
  const started = Date.now();
  const output = await aiProvider().fill({
    ...prompt,
    tool: FILL_FORM_TOOL,
    timeoutMs: AI_FILL_TIMEOUT_MS,
  });
  const ms = Date.now() - started;
  const suggestion = checkSuggestion(output, {
    screen: fixture.screen,
    today,
    categoryIds: new Set(CATEGORIES.map((c) => c.id)),
    reasonIds: new Set(REASONS.map((r) => r.id)),
  });
  return { suggestion, ms };
}

describe("AI fill against the real model", () => {
  const slow: string[] = [];

  for (const fixture of notes as Fixture[]) {
    it(fixture.id, async () => {
      const { suggestion, ms } = await fill(fixture);
      if (ms > 5000) slow.push(`${fixture.id}: ${ms} ms`);
      const want = fixture.expect;
      const got = suggestion as Record<string, unknown>;

      for (const id of want.categoryIds ?? [])
        expect(suggestion.categoryIds, "categoryIds").toContain(id);
      if (want.outcome)
        expect(oneOf(got["outcome"], want.outcome), `outcome ${got["outcome"]}`).toBe(true);
      if (want.result)
        expect(oneOf(got["result"], want.result), `result ${got["result"]}`).toBe(true);
      if (want.lostReasonId)
        expect(oneOf(got["lostReasonId"], want.lostReasonId), `reason ${got["lostReasonId"]}`).toBe(
          true,
        );
      if (want.expectedPurchase)
        expect(
          oneOf(got["expectedPurchase"], want.expectedPurchase),
          `expected ${got["expectedPurchase"]}`,
        ).toBe(true);
      if (want.intent)
        expect(oneOf(got["intent"], want.intent), `intent ${got["intent"]}`).toBe(true);
      if (want.followUp) {
        expect(suggestion.followUp, "followUp").toBeDefined();
        const date = want.followUp.date ? resolveDate(want.followUp.date) : null;
        if (date) expect(suggestion.followUp?.date, "followUp.date").toBe(date);
        if (want.followUp.timeSlot)
          expect(suggestion.followUp?.timeSlot, "timeSlot").toBe(want.followUp.timeSlot);
        if (want.followUp.method)
          expect(suggestion.followUp?.method, "method").toBe(want.followUp.method);
      }
      if (want.remarksScript) expect(suggestion.remarks ?? "").toMatch(SCRIPT[want.remarksScript]);
      // Every date that came through is a real day from today on.
      if (suggestion.followUp?.date) expect(suggestion.followUp.date >= today).toBe(true);
    });
  }

  it("answers within the SOW's five seconds (reported, not enforced: network)", () => {
    if (slow.length) console.warn(`Slower than 5 s:\n  ${slow.join("\n  ")}`);
    expect(true).toBe(true);
  });
});
