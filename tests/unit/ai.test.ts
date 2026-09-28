import { describe, expect, it } from "vitest";
import { acceptedAsSuggested, checkSuggestion, isEmptySuggestion } from "@/lib/ai/check";
import { buildFillPrompt, dayLine, FILL_FORM_TOOL, transcribePrompt } from "@/lib/ai/prompt";
import { istDayStart } from "@/lib/ai/suggest";
import {
  aiFinalValues,
  aiSettingsInput,
  recordAiOutcomeInput,
  suggestFieldsInput,
} from "@/lib/validation/ai";

// M20 without a model or a database: what the AI is told, and what of its answer the
// form is allowed to see.

const today = "2026-09-25"; // a Friday
const ctx = {
  today,
  categoryIds: new Set(["cat-sherwani", "cat-wedding"]),
  reasonIds: new Set(["reason-price"]),
};

const answer = (extra: Record<string, unknown> = {}) => ({
  categoryIds: [],
  expectedPurchase: null,
  remarks: null,
  outcome: null,
  lostReasonId: null,
  contact: null,
  visit: null,
  result: null,
  intent: null,
  confidence: {},
  ...extra,
});

describe("checkSuggestion", () => {
  it("keeps known ids only and drops the rest", () => {
    const s = checkSuggestion(
      answer({
        categoryIds: ["cat-sherwani", "made-up", "cat-sherwani"],
        outcome: "NOT_INTERESTED",
        lostReasonId: "nope",
      }),
      { ...ctx, screen: "visit" },
    );
    expect(s.categoryIds).toEqual(["cat-sherwani"]);
    expect(s.outcome).toBe("NOT_INTERESTED");
    expect(s.lostReasonId).toBeUndefined();
  });

  it("the staff's call comes before the customer's visit day", () => {
    const s = checkSuggestion(
      answer({
        outcome: "DECIDE_LATER",
        contact: {
          date: "2026-09-26",
          timeSlot: "EVENING",
          method: "CALL",
          reason: "Confirm Sunday",
        },
        visit: { date: "2026-09-27", timeSlot: null },
      }),
      { ...ctx, screen: "visit" },
    );
    expect(s.followUp).toEqual({
      date: "2026-09-26",
      timeSlot: "EVENING",
      method: "CALL",
      reason: "Confirm Sunday",
    });
  });

  it("with no call asked for, the visit day becomes a VISIT follow-up", () => {
    const s = checkSuggestion(
      answer({ outcome: "DECIDE_LATER", visit: { date: "2026-09-27", timeSlot: "MORNING" } }),
      { ...ctx, screen: "visit" },
    );
    expect(s.followUp).toEqual({ date: "2026-09-27", timeSlot: "MORNING", method: "VISIT" });
  });

  it("rejects a past or impossible date but keeps the rest of the plan", () => {
    const past = checkSuggestion(
      answer({
        contact: { date: "2026-09-24", timeSlot: "MORNING", method: "WHATSAPP", reason: null },
      }),
      { ...ctx, screen: "followUp" },
    );
    expect(past.followUp).toEqual({
      date: undefined,
      timeSlot: "MORNING",
      method: "WHATSAPP",
      reason: undefined,
    });
    const bad = checkSuggestion(answer({ visit: { date: "2026-02-30", timeSlot: null } }), {
      ...ctx,
      screen: "followUp",
    });
    expect(bad.followUp).toBeUndefined();
  });

  it("a planned follow-up on Record visit means 'will decide later' (BR-04)", () => {
    const s = checkSuggestion(
      answer({
        contact: { date: "2026-09-26", timeSlot: "EVENING", method: "CALL", reason: null },
      }),
      { ...ctx, screen: "visit" },
    );
    expect(s.outcome).toBe("DECIDE_LATER");
  });

  it("gives each screen only its own fields", () => {
    const full = answer({
      categoryIds: ["cat-sherwani"],
      expectedPurchase: "THIS_WEEK",
      remarks: "Spoke, will come Sunday",
      outcome: "DECIDE_LATER",
      result: "WILL_VISIT",
      intent: "HOT",
      visit: { date: "2026-09-27", timeSlot: null },
    });
    expect(Object.keys(checkSuggestion(full, { ...ctx, screen: "followUp" })).sort()).toEqual([
      "check",
      "followUp",
    ]);
    const result = checkSuggestion(full, { ...ctx, screen: "followUpResult" });
    expect(Object.keys(result).sort()).toEqual(["check", "followUp", "remarks", "result"]);
    const visit = checkSuggestion(full, { ...ctx, screen: "visit" });
    expect(visit.result).toBeUndefined();
    expect(visit.intent).toBe("HOT");
  });

  it("on Update follow-up a next day only goes with 'will visit' or 'call later'", () => {
    const s = checkSuggestion(
      answer({
        result: "NOT_REACHABLE",
        contact: { date: "2026-09-26", timeSlot: null, method: null, reason: null },
      }),
      { ...ctx, screen: "followUpResult" },
    );
    expect(s.result).toBe("NOT_REACHABLE");
    expect(s.followUp).toBeUndefined();
  });

  it("cuts text to the form's limits and squashes whitespace", () => {
    const s = checkSuggestion(answer({ remarks: `  a  ${"b".repeat(600)}  ` }), {
      ...ctx,
      screen: "visit",
    });
    expect(s.remarks).toHaveLength(500);
    expect(s.remarks?.startsWith("a b")).toBe(true);
    const note = checkSuggestion(answer({ result: "CALL_LATER", remarks: "x".repeat(300) }), {
      ...ctx,
      screen: "followUpResult",
    });
    expect(note.remarks).toHaveLength(250);
  });

  it("names the fields it was unsure about", () => {
    const s = checkSuggestion(
      answer({
        categoryIds: ["cat-sherwani"],
        intent: "WARM",
        contact: { date: "2026-09-26", timeSlot: "EVENING", method: "CALL", reason: null },
        confidence: { categoryIds: 0.4, intent: 0.9, contact: 0.5 },
      }),
      { ...ctx, screen: "visit" },
    );
    expect(s.check.sort()).toEqual(["categoryIds", "followUp"]);
  });

  it("refuses an answer that is not the tool's shape, and knows an empty one", () => {
    expect(() => checkSuggestion({ outcome: "MAYBE" }, { ...ctx, screen: "visit" })).toThrow();
    expect(() => checkSuggestion("nonsense", { ...ctx, screen: "visit" })).toThrow();
    expect(isEmptySuggestion(checkSuggestion(answer(), { ...ctx, screen: "visit" }))).toBe(true);
  });
});

describe("acceptedAsSuggested", () => {
  const suggestion = {
    categoryIds: ["cat-wedding", "cat-sherwani"],
    outcome: "DECIDE_LATER" as const,
    followUp: {
      date: "2026-09-26",
      timeSlot: "EVENING" as const,
      method: "CALL" as const,
      reason: "Confirm",
    },
    check: [],
  };

  it("is true when every suggested field was saved as it was (order and reason aside)", () => {
    expect(
      acceptedAsSuggested(suggestion, {
        categoryIds: ["cat-sherwani", "cat-wedding"],
        outcome: "DECIDE_LATER",
        followUp: {
          date: "2026-09-26",
          timeSlot: "EVENING",
          method: "CALL",
          reason: "Confirm the Sunday visit",
        },
        remarks: "typed by hand", // not suggested, so not counted
      }),
    ).toBe(true);
  });

  it("is false when a suggested field was changed, or nothing was suggested", () => {
    expect(acceptedAsSuggested(suggestion, { ...suggestion, outcome: "PURCHASED" })).toBe(false);
    expect(
      acceptedAsSuggested(suggestion, {
        ...suggestion,
        followUp: { date: "2026-09-27", timeSlot: "EVENING", method: "CALL" },
      }),
    ).toBe(false);
    expect(acceptedAsSuggested({ check: [] }, {})).toBe(false);
  });

  it("compares the plan only on what the saving screen has (Update follow-up has no slot)", () => {
    const next = {
      result: "CALL_LATER" as const,
      followUp: { date: "2026-09-28", timeSlot: "EVENING" as const, method: "CALL" as const },
      check: [],
    };
    expect(
      acceptedAsSuggested(next, { result: "CALL_LATER", followUp: { date: "2026-09-28" } }),
    ).toBe(true);
  });
});

describe("the prompt", () => {
  const prompt = buildFillPrompt({
    screen: "visit",
    storeName: "Deepak Silk",
    today,
    festivals: [{ name: "Diwali", date: "2026-11-08" }],
    categories: [{ id: "cat-sherwani", nameEn: "Sherwani", nameHi: "शेरवानी", nameGu: "શેરવાની" }],
    reasons: [{ id: "reason-price", nameEn: "Price", nameHi: "कीमत", nameGu: "કિંમત" }],
    customerFirstName: "Ramesh",
    enquiryTitle: "Wedding",
    language: "hi",
    text: "Sunday aayega",
  });

  it("carries today with its weekday, the coming days, the festivals and both lists", () => {
    expect(prompt.system).toContain("Friday 25 Sep 2026 = 2026-09-25");
    expect(prompt.system).toContain("Saturday 26 Sep 2026 = 2026-09-26");
    expect(prompt.system).toContain("Diwali = 2026-11-08");
    expect(prompt.system).toContain("cat-sherwani = Sherwani / शेरवानी / શેરવાની");
    expect(prompt.system).toContain("reason-price = Price / कीमत / કિંમત");
    expect(prompt.user).toContain("Ramesh");
    expect(prompt.user).toContain("Wedding");
    expect(prompt.user).toContain("Hindi");
    expect(prompt.user.endsWith("Sunday aayega")).toBe(true);
  });

  it("dayLine reads a calendar day without any time zone", () => {
    expect(dayLine("2026-01-01")).toBe("Thursday 1 Jan 2026 = 2026-01-01");
    expect(dayLine("2026-12-31")).toBe("Thursday 31 Dec 2026 = 2026-12-31");
  });

  it("the tool is strict: every property required, additionalProperties false", () => {
    const parameters = FILL_FORM_TOOL.parameters as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(parameters.additionalProperties).toBe(false);
    expect([...parameters.required].sort()).toEqual(Object.keys(parameters.properties).sort());
    expect(
      transcribePrompt("Deepak Silk", [{ id: "x", nameEn: "Sherwani", nameHi: "", nameGu: "" }]),
    ).toContain("Sherwani");
  });
});

describe("istDayStart", () => {
  it("is midnight in India, whatever the server's clock zone", () => {
    // 01:30 IST on the 26th is 20:00 UTC on the 25th.
    expect(istDayStart(new Date("2026-09-25T20:00:00.000Z")).toISOString()).toBe(
      "2026-09-25T18:30:00.000Z",
    );
    expect(istDayStart(new Date("2026-09-25T10:00:00.000Z")).toISOString()).toBe(
      "2026-09-24T18:30:00.000Z",
    );
  });
});

describe("input schemas", () => {
  it("a note must be present and not longer than 2,000 characters", () => {
    expect(
      suggestFieldsInput.safeParse({ screen: "visit", customerId: "c1", text: "  " }).success,
    ).toBe(false);
    expect(
      suggestFieldsInput.safeParse({ screen: "visit", customerId: "c1", text: "x".repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      suggestFieldsInput.safeParse({ screen: "chat", customerId: "c1", text: "hi" }).success,
    ).toBe(false);
    expect(
      suggestFieldsInput.safeParse({
        screen: "followUp",
        customerId: "c1",
        text: "hi",
        audioSeconds: 12,
      }).success,
    ).toBe(true);
  });

  it("final values drop unknown keys and empty strings", () => {
    const parsed = aiFinalValues.parse({
      outcome: "",
      intent: "HOT",
      extra: 1,
      followUp: { date: "2026-09-26" },
    });
    expect(parsed).toEqual({ intent: "HOT", followUp: { date: "2026-09-26" } });
    expect(
      recordAiOutcomeInput.safeParse({
        suggestionId: "s1",
        finalValues: { followUp: { date: "bad" } },
      }).success,
    ).toBe(false);
  });

  it("the settings form posts a checkbox and a number as text", () => {
    expect(aiSettingsInput.parse({ enabled: "on", dailyLimit: "50" })).toEqual({
      enabled: true,
      dailyLimit: 50,
    });
    expect(aiSettingsInput.parse({ dailyLimit: "1" })).toEqual({ enabled: false, dailyLimit: 1 });
    for (const bad of ["0", "1001", "2.5", "abc", ""]) {
      expect(aiSettingsInput.safeParse({ enabled: "on", dailyLimit: bad }).success, bad).toBe(
        false,
      );
    }
  });
});
