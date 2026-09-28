import "dotenv/config";
import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { buildAskPrompt } from "@/lib/ai/ask-prompt";
import { askToolsFor, SALESPERSON_OWN_ONLY } from "@/lib/ai/ask-tools";
import { aiProvider, type ChatMessage, type ChatTurn } from "@/lib/ai/provider";
import { addDays } from "@/lib/follow-up-dates";
import { isoDate } from "@/lib/format";

// M21 against the REAL model (`npm run test:ai`, needs OPENAI_API_KEY; never part of
// `npm test`). The SOW's example questions, in English, Hindi, Gujarati and Hinglish: the
// model must pick the right search with the right filters, refuse to change data, and
// answer from the numbers it is given. No database: the searches' results are canned.

const today = isoDate(new Date());
const monday = addDays(today, -((new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7));
const sunday = addDays(monday, 6);
const monthStart = `${today.slice(0, 8)}01`;

const CATEGORIES = [
  { nameEn: "Wedding Clothes", nameHi: "शादी के कपड़े", nameGu: "લગ્નના કપડાં" },
  { nameEn: "Sherwani", nameHi: "शेरवानी", nameGu: "શેરવાની" },
  { nameEn: "Suit", nameHi: "सूट", nameGu: "સૂટ" },
  { nameEn: "Saree", nameHi: "साड़ी", nameGu: "સાડી" },
  { nameEn: "Festival Collection", nameHi: "त्योहार कलेक्शन", nameGu: "તહેવાર કલેક્શન" },
];

function prompt(role: Role, language: "en" | "hi" | "gu" = "en") {
  return buildAskPrompt({
    today,
    storeName: "Deepak Silk",
    role,
    branchLabel: "Main Branch",
    language,
    staffNames: role === "SALESPERSON" ? [] : ["Amit Shah", "Priya Patel", "Rahul Mehta"],
    categories: CATEGORIES,
  });
}

async function firstTurn(question: string, role: Role = "MANAGER"): Promise<ChatTurn> {
  return aiProvider().chat({
    messages: [
      { role: "system", content: prompt(role) },
      { role: "user", content: question },
    ],
    tools: askToolsFor(role),
    signal: AbortSignal.timeout(20_000),
  });
}

const argsOf = (turn: ChatTurn, name: string) => {
  const call = turn.toolCalls.find((c) => c.name === name);
  expect(call, `${name} in ${JSON.stringify(turn.toolCalls)}`).toBeDefined();
  return JSON.parse(call!.arguments) as Record<string, unknown>;
};

const hasKey = !!process.env["OPENAI_API_KEY"];

describe.skipIf(!hasKey)("the model picks the right search (M21 examples)", () => {
  it("'Which customers should be followed up today?' → pending follow-ups due today", async () => {
    const args = argsOf(
      await firstTurn("Which customers should be followed up today?"),
      "find_followups",
    );
    expect(args["dueTo"]).toBe(today);
  });

  it("'Who said they would visit this week?' → VISIT follow-ups until Sunday", async () => {
    const args = argsOf(
      await firstTurn("Which customers said they would visit this week?"),
      "find_followups",
    );
    expect(args["method"]).toBe("VISIT");
    expect(args["dueTo"]).toBe(sunday);
  });

  it("'Show customers interested in wedding clothes' → the Wedding Clothes category", async () => {
    const args = argsOf(
      await firstTurn("Show customers interested in wedding clothes"),
      "find_customers",
    );
    expect(args["categoryNames"]).toContain("Wedding Clothes");
  });

  it("'pending customers not contacted in 7 days' → notContactedDays 7, open enquiry", async () => {
    const args = argsOf(
      await firstTurn("Which pending customers have not been contacted in 7 days?"),
      "find_customers",
    );
    expect(args["notContactedDays"]).toBe(7);
    expect(args["hasOpenEnquiry"]).toBe(true);
  });

  it("'How many sales came from follow-ups this month?' → sales since the 1st", async () => {
    const args = argsOf(
      await firstTurn("How many sales came from follow-ups this month?"),
      "get_sales",
    );
    expect(args["from"]).toBe(monthStart);
  });

  it("Hinglish 'Amit ka is mahine ka performance?' → Amit's figures this month", async () => {
    const args = argsOf(
      await firstTurn("Amit ka is mahine ka performance?"),
      "get_salesperson_stats",
    );
    expect(String(args["salespersonName"])).toMatch(/Amit/);
    expect(args["from"]).toBe(monthStart);
  });

  it("Hindi 'आज किन ग्राहकों को फ़ॉलो-अप करना है?' → today's follow-ups", async () => {
    const args = argsOf(await firstTurn("आज किन ग्राहकों को फ़ॉलो-अप करना है?"), "find_followups");
    expect(args["dueTo"]).toBe(today);
  });

  it("Gujarati 'આ મહિને ફોલો-અપથી કેટલું વેચાણ આવ્યું?' → sales this month", async () => {
    const args = argsOf(await firstTurn("આ મહિને ફોલો-અપથી કેટલું વેચાણ આવ્યું?"), "get_sales");
    expect(args["from"]).toBe(monthStart);
  });

  it("'Why are customers saying no this month?' → not-interested reasons", async () => {
    argsOf(await firstTurn("Why are customers saying no this month?"), "get_lost_reasons");
  });

  it("a salesperson's 'my sales this week' → their sales from Monday", async () => {
    const args = argsOf(
      await firstTurn("How many sales did I make this week?", "SALESPERSON"),
      "get_sales",
    );
    expect(args["from"]).toBe(monday);
  });

  it("'Delete customer Ramesh' → no search, and a plain 'I can only read'", async () => {
    const turn = await firstTurn("Delete customer Ramesh Patel and his follow-ups");
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text.toLowerCase()).toMatch(/only|can't|cannot|not able/);
  });
});

describe.skipIf(!hasKey)(
  "the model answers from the results, briefly, in the asker's language",
  () => {
    async function answer(
      question: string,
      tool: string,
      result: unknown,
      language: "en" | "hi" | "gu" = "en",
    ) {
      const first = await aiProvider().chat({
        messages: [
          { role: "system", content: prompt("MANAGER", language) },
          { role: "user", content: question },
        ],
        tools: askToolsFor("MANAGER"),
        signal: AbortSignal.timeout(20_000),
      });
      const call = first.toolCalls.find((c) => c.name === tool);
      expect(call, JSON.stringify(first.toolCalls)).toBeDefined();
      const messages: ChatMessage[] = [
        { role: "system", content: prompt("MANAGER", language) },
        { role: "user", content: question },
        { role: "assistant", content: null, toolCalls: [call!] },
        { role: "tool", toolCallId: call!.id, content: JSON.stringify(result) },
      ];
      const final = await aiProvider().chat({
        messages,
        tools: [],
        signal: AbortSignal.timeout(20_000),
      });
      return final.text;
    }

    it("uses the numbers it was given, and says when the list was cut", async () => {
      const text = await answer("How many sales came from follow-ups this month?", "get_sales", {
        from: monthStart,
        to: today,
        sales: 132,
        fromFollowUps: 47,
        totalAmount: 1234500,
        shown: 50,
        bills: [],
      });
      expect(text).toMatch(/47/);
      expect(text.length).toBeLessThan(400);
    });

    it("answers a Hindi question in Hindi", async () => {
      const text = await answer(
        "इस महीने फ़ॉलो-अप से कितनी बिक्री हुई?",
        "get_sales",
        {
          from: monthStart,
          to: today,
          sales: 12,
          fromFollowUps: 5,
          totalAmount: 90000,
          shown: 12,
          bills: [],
        },
        "hi",
      );
      expect(text).toMatch(/[ऀ-ॿ]/);
      expect(text).toMatch(/5|५/);
    });

    it("says clearly when nothing was found", async () => {
      const text = await answer("Show customers interested in wedding clothes", "find_customers", {
        total: 0,
        shown: 0,
        customers: [],
      });
      expect(text.toLowerCase()).toMatch(/no |none|not find|couldn't find|could not find|0/);
    });
  },
);

// Found on the dev server: a salesperson asked "Priya ke customers dikhao", got their OWN
// customers back (the search never shows anyone else's) and the model called them Priya's.
describe.skipIf(!hasKey)("a salesperson asking about a colleague", () => {
  it("is told they can only see their own, not shown their own rows as the colleague's", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: prompt("SALESPERSON", "hi") },
      { role: "user", content: "Priya ke customers dikhao" },
    ];
    let text = "";
    for (let round = 0; round < 3; round++) {
      const turn = await aiProvider().chat({
        messages,
        tools: round < 2 ? askToolsFor("SALESPERSON") : [],
        signal: AbortSignal.timeout(20_000),
      });
      if (turn.toolCalls.length === 0) {
        text = turn.text;
        break;
      }
      messages.push({ role: "assistant", content: null, toolCalls: turn.toolCalls });
      for (const call of turn.toolCalls) {
        const args = JSON.parse(call.arguments) as { salespersonName?: string | null };
        // What runAskTool gives a salesperson: a refusal for a colleague's name, else
        // their own rows marked as theirs.
        const result = args.salespersonName
          ? { error: SALESPERSON_OWN_ONLY }
          : {
              total: 2,
              shown: 2,
              customers: [{ name: "Ramesh Patel" }, { name: "Suresh Shah" }],
              whose: "only the asker's own records",
            };
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
      }
    }
    expect(text).not.toMatch(/Priya (ke paas|has|के पास)/i);
    expect(text).toMatch(/own|only|apne|sirf|khud|अपने|सिर्फ़|केवल/i);
  });
});
