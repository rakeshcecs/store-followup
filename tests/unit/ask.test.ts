import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askCalendar, buildAskPrompt } from "@/lib/ai/ask-prompt";
import { ASK_TOOLS, askToolsFor } from "@/lib/ai/ask-tools";
import { aiProvider } from "@/lib/ai/provider";
import { askInput } from "@/lib/validation/ai";

// M21 without a database or a model: the calendar the model is given, the tool schemas,
// the provider's stream reader, and the source rule that the searches never write.

describe("the calendar in the prompt", () => {
  it("names this week, last week, this month and last month for a Friday", () => {
    const lines = askCalendar("2026-09-25").join("\n");
    expect(lines).toContain("Today: Friday 2026-09-25");
    expect(lines).toContain("This week: Monday 2026-09-21 to Sunday 2026-09-27");
    expect(lines).toContain("Last week: 2026-09-14 to 2026-09-20");
    expect(lines).toContain("This month: 2026-09-01 to 2026-09-30");
    expect(lines).toContain("Last month: 2026-08-01 to 2026-08-31");
    expect(lines).toContain("Saturday 2026-09-26");
  });

  it("a Sunday belongs to the week that started on Monday; January's last month is December", () => {
    const lines = askCalendar("2026-01-04").join("\n");
    expect(lines).toContain("This week: Monday 2025-12-29 to Sunday 2026-01-04");
    expect(lines).toContain("Last month: 2025-12-01 to 2025-12-31");
  });
});

describe("the prompt", () => {
  const base = {
    today: "2026-09-25",
    storeName: "Deepak Silk",
    branchLabel: "Branch A",
    language: "hi" as const,
    staffNames: ["Amit Shah"],
    categories: [{ nameEn: "Sherwani", nameHi: "शेरवानी", nameGu: "શેરવાની" }],
  };

  it("tells the model a salesperson only ever sees their own data", () => {
    const prompt = buildAskPrompt({ ...base, role: "SALESPERSON", staffNames: [] });
    expect(prompt).toContain("ONLY their own customers");
    expect(prompt).not.toContain("Staff:");
  });

  it("gives a manager their branches, staff and categories, and the rules", () => {
    const prompt = buildAskPrompt({ ...base, role: "MANAGER" });
    expect(prompt).toContain("Searches cover Branch A");
    expect(prompt).toContain("Staff: Amit Shah.");
    expect(prompt).toContain("Sherwani / शेरवानी / શેરવાની");
    expect(prompt).toContain("Never guess or invent a number");
    expect(prompt).toContain("If unsure, use Hindi");
    expect(prompt).toContain("You can only read");
  });
});

describe("the searches offered to the model", () => {
  it("are strict JSON Schemas: every property required, nothing extra", () => {
    for (const tool of ASK_TOOLS) {
      const schema = tool.parameters as {
        type: string;
        properties: Record<string, { type: string | string[] }>;
        required: string[];
        additionalProperties: boolean;
      };
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
      // Optional filters are "type or null" — strict mode has no optional properties.
      for (const property of Object.values(schema.properties)) {
        expect(property.type).toContain("null");
      }
    }
  });

  it("are the six of the module prompt; a salesperson gets the four about their own work", () => {
    expect(ASK_TOOLS.map((tool) => tool.name)).toEqual([
      "find_followups",
      "find_customers",
      "get_sales",
      "get_salesperson_stats",
      "get_lost_reasons",
      "get_dashboard",
    ]);
    expect(askToolsFor("SALESPERSON").map((tool) => tool.name)).toEqual([
      "find_followups",
      "find_customers",
      "get_sales",
      "get_salesperson_stats",
    ]);
    expect(askToolsFor("MANAGER")).toHaveLength(6);
    expect(askToolsFor("ADMIN")).toHaveLength(6);
  });
});

describe("no code path where the AI can change data (M21 'Done when')", () => {
  const WRITE =
    /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRaw|\$transaction/;

  it("the searches and everything they call only read", () => {
    for (const path of [
      "src/lib/ai/ask-tools.ts",
      "src/lib/dashboard.ts",
      "src/lib/reports/definitions.ts",
      "src/lib/reports/core.ts",
    ]) {
      expect(WRITE.test(readFileSync(path, "utf8")), path).toBe(false);
    }
  });

  it("the ask flow writes nothing but its own log row", () => {
    const source = readFileSync("src/lib/ai/ask.ts", "utf8");
    const writes = [
      ...source.matchAll(/db\.(\w+)\.(create|update|updateMany|upsert|delete\w*)\(/g),
    ];
    expect(writes.map(([, model, method]) => `${model}.${method}`)).toEqual([
      "aiQuestionLog.create",
      "aiQuestionLog.updateMany", // "Was this wrong?"
    ]);
    expect(source).not.toMatch(/\$executeRaw|\$queryRaw|\$transaction/);
  });
});

describe("the question", () => {
  it("is 1–500 characters after trimming", () => {
    expect(askInput.safeParse({ question: "  " }).success).toBe(false);
    expect(askInput.safeParse({ question: "x".repeat(501) }).success).toBe(false);
    expect(askInput.parse({ question: "  who today?  " })).toEqual({ question: "who today?" });
  });
});

describe("the provider's streamed answer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const sse = (chunks: unknown[]) => {
    const text =
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    // Split mid-line, as a network would.
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    });
  };

  it("passes text through as it comes and rebuilds tool calls from their pieces", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetch = vi.fn(
      async () =>
        new Response(
          sse([
            { choices: [{ delta: { content: "Checking" } }] },
            { choices: [{ delta: { content: "…" } }] },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "c1",
                        function: { name: "find_followups", arguments: '{"sta' },
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                { delta: { tool_calls: [{ index: 0, function: { arguments: 'tus":null}' } }] } },
              ],
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 1, id: "c2", function: { name: "get_sales", arguments: "{}" } },
                    ],
                  },
                },
              ],
            },
          ]),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const pieces: string[] = [];
    const turn = await aiProvider().chat({
      messages: [{ role: "user", content: "who today?" }],
      tools: [],
      signal: AbortSignal.timeout(5_000),
      onText: (delta) => pieces.push(delta),
    });
    expect(pieces).toEqual(["Checking", "…"]);
    expect(turn).toEqual({
      text: "Checking…",
      toolCalls: [
        { id: "c1", name: "find_followups", arguments: '{"status":null}' },
        { id: "c2", name: "get_sales", arguments: "{}" },
      ],
    });
    // No tools offered = no "tools" key (the API refuses an empty list); always streamed.
    const body = JSON.parse(
      String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body).not.toHaveProperty("tools");
    expect(body.stream).toBe(true);
  });

  it("an HTTP error is a provider error, not a crash", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("quota", { status: 429 })),
    );
    await expect(
      aiProvider().chat({
        messages: [{ role: "user", content: "q" }],
        tools: [],
        signal: AbortSignal.timeout(5_000),
      }),
    ).rejects.toMatchObject({ name: "AiProviderError", kind: "http" });
  });
});
