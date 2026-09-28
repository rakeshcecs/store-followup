import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { askActor, askCore, askPreflight, markAnswerWrongCore, isFirstTimeAsker } =
  await import("@/lib/ai/ask");
const { ASK_MAX_ROWS, SALESPERSON_OWN_ONLY, askText, runAskTool } =
  await import("@/lib/ai/ask-tools");
const { db } = await import("@/lib/db");
const { calendarDay } = await import("@/lib/follow-ups");
const { addDays } = await import("@/lib/follow-up-dates");
const { isoDate } = await import("@/lib/format");
const { runReport } = await import("@/lib/reports/run");
const { SETTING } = await import("@/lib/settings");
const { makeCustomer, makeEnquiry } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs } = await import("../helpers/session");
const { requireUser } = await import("@/lib/auth");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
type SessionUser = import("@/lib/auth").SessionUser;
type AiProvider = import("@/lib/ai/provider").AiProvider;
type AskEvent = import("@/lib/validation/ai").AskEvent;
type BranchScope = import("@/lib/permissions").BranchScope;

// M21 against the real database, with a fake model where one is needed. Two branches, two
// managers, two salespeople and an admin. The two "Done when" lines:
// - a salesperson asking about all customers only gets their own;
// - there is no code path where the AI can change data (every search is read-only).

let store: TestStore;
const now = new Date();
const today = isoDate(now);

const asUser = (user: {
  id: string;
  role: "ADMIN" | "MANAGER" | "SALESPERSON";
  homeBranchId: string;
}): SessionUser => ({
  id: user.id,
  role: user.role,
  homeBranchId: user.homeBranchId,
  branchIds: [user.homeBranchId],
  language: "en",
  mustChangePin: false,
});

const branchOf = (user: { homeBranchId: string }): BranchScope => ({
  all: false,
  branchIds: [user.homeBranchId],
});

async function run(
  user: Parameters<typeof asUser>[0],
  tool: string,
  args: Record<string, unknown> = {},
) {
  const session = asUser(user);
  const actor = askActor(session, branchOf(user), now, "en");
  return runAskTool(tool, JSON.stringify(args), actor, await askText("en"));
}

async function setAi(enabled: boolean, dailyLimit = 100) {
  for (const [key, value] of [
    [SETTING.aiEnabled, enabled],
    [SETTING.aiDailyLimit, dailyLimit],
  ] as const) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

// A customer with an open enquiry and a pending follow-up. Due well ahead: the test database
// is shared, and a hundred follow-ups due today would push other files' rows off the first
// page of a list sorted by due date (offline-sync.test.ts reads the admin's first page).
const DUE = addDays(today, 200);

async function customerWithFollowUp(options: {
  branchId: string;
  assignedToId: string;
  name: string;
  method?: "CALL" | "VISIT";
  categoryId?: string;
}) {
  const customer = await makeCustomer(options.branchId, options.assignedToId);
  await db.customer.update({ where: { id: customer.id }, data: { name: options.name } });
  const enquiry = await makeEnquiry(customer.id, options.assignedToId);
  if (options.categoryId) {
    await db.enquiryCategory.create({
      data: { enquiryId: enquiry.id, categoryId: options.categoryId },
    });
  }
  await db.followUp.create({
    data: {
      branchId: options.branchId,
      customerId: customer.id,
      enquiryId: enquiry.id,
      clientId: randomUUID(),
      dueDate: calendarDay(DUE),
      timeSlot: "EVENING",
      method: options.method ?? "CALL",
      assignedToId: options.assignedToId,
      createdFrom: "VISIT",
    },
  });
  return { customer, enquiry };
}

let sherwani: string;
let mine: Awaited<ReturnType<typeof customerWithFollowUp>>;

beforeEach(async () => {
  process.env["OPENAI_API_KEY"] = process.env["OPENAI_API_KEY"] || "test-key";
  store = await makeStore();
  await db.user.update({ where: { id: store.salesA.id }, data: { fullName: "Amit Shah" } });
  await db.user.update({ where: { id: store.salesB.id }, data: { fullName: "Priya Patel" } });
  sherwani = (
    await db.requirementCategory.create({
      data: { nameEn: "Sherwani", nameHi: "शेरवानी", nameGu: "શેરવાની", sortOrder: 1 },
    })
  ).id;
  mine = await customerWithFollowUp({
    branchId: store.branchA.id,
    assignedToId: store.salesA.id,
    name: "Ramesh Mine",
    method: "VISIT",
    categoryId: sherwani,
  });
  // Same branch, someone else's customer.
  await customerWithFollowUp({
    branchId: store.branchA.id,
    assignedToId: store.managerA.id,
    name: "Suresh Colleague",
  });
  // The other branch.
  await customerWithFollowUp({
    branchId: store.branchB.id,
    assignedToId: store.salesB.id,
    name: "Mahesh Other Branch",
    categoryId: sherwani,
  });
  await db.sale.create({
    data: {
      branchId: store.branchA.id,
      customerId: mine.customer.id,
      enquiryId: mine.enquiry.id,
      clientId: randomUUID(),
      billNumber: `B${randomUUID().slice(0, 6)}`,
      billDate: calendarDay(today),
      billAmount: 1000,
      salespersonId: store.salesA.id,
      fromFollowUp: true,
    },
  });
  await setAi(true);
});

afterAll(() => db.$disconnect());

const names = (outcome: { forModel: unknown }, list: string) =>
  ((outcome.forModel as Record<string, { customer?: string; name?: string }[]>)[list] ?? []).map(
    (row) => row.customer ?? row.name,
  );

describe("permissions (M21.05, BR-18)", () => {
  it("a salesperson asking about all customers only gets their own", async () => {
    const followUps = await run(store.salesA, "find_followups");
    expect(names(followUps, "followUps")).toEqual(["Ramesh Mine"]);
    const customers = await run(store.salesA, "find_customers", { hasOpenEnquiry: true });
    expect(names(customers, "customers")).toEqual(["Ramesh Mine"]);
    // Naming a colleague is refused in words the model passes on; their own name works.
    const asked = await run(store.salesA, "find_followups", { salespersonName: "Priya" });
    expect(asked.error).toBe(SALESPERSON_OWN_ONLY);
    expect(asked.table).toBeNull();
    const self = await run(store.salesA, "find_followups", { salespersonName: "amit" });
    expect(names(self, "followUps")).toEqual(["Ramesh Mine"]);
    // Every result a salesperson gets says whose it is.
    expect(customers.forModel).toMatchObject({ whose: "only the asker's own records" });
    const sales = await run(store.salesB, "get_sales");
    expect((sales.forModel as { salesCount: number }).salesCount).toBe(0);
  });

  it("a manager sees their branch, not the other one", async () => {
    const a = await run(store.managerA, "find_followups");
    expect(names(a, "followUps").sort()).toEqual(["Ramesh Mine", "Suresh Colleague"]);
    const b = await run(store.managerB, "find_followups");
    expect(names(b, "followUps")).toEqual(["Mahesh Other Branch"]);
    const wedding = await run(store.managerA, "find_customers", { categoryNames: ["sherwani"] });
    expect(names(wedding, "customers")).toEqual(["Ramesh Mine"]);
    // "Amit's customers": only those assigned to him, not the whole branch.
    const amit = await run(store.managerA, "find_customers", { salespersonName: "Amit" });
    expect(names(amit, "customers")).toEqual(["Ramesh Mine"]);
  });

  it("the store-wide searches are a manager's; a salesperson is refused", async () => {
    const refused = await run(store.salesA, "get_dashboard");
    expect(refused.error).toMatch(/No search/);
    const lost = await run(store.salesA, "get_lost_reasons");
    expect(lost.error).toMatch(/No search/);
    const figures = await run(store.managerA, "get_dashboard");
    expect(figures.forModel).toMatchObject({ sales: 1, salesFromFollowUps: 1 });
    // A branch the manager cannot reach is not found, and the ones they can are named.
    const other = await run(store.managerA, "get_dashboard", { branchName: store.branchB.name });
    expect(other.error).toMatch(/cannot see a branch/);
  });

  it("a branch the question names: refused when out of reach on every search, never relabelled", async () => {
    // Manager B asks about Branch A: every search says so, none answers with Branch B's rows.
    for (const tool of [
      "find_followups",
      "find_customers",
      "get_sales",
      "get_salesperson_stats",
      "get_lost_reasons",
      "get_dashboard",
    ]) {
      const outcome = await run(store.managerB, tool, { branchName: store.branchA.name });
      expect(outcome.error, tool).toMatch(/cannot see a branch/);
      expect(outcome.table, tool).toBeNull();
    }
    // The admin, on Branch A, may name Branch B and gets Branch B's rows.
    const b = await run(store.admin, "find_followups", { branchName: store.branchB.name });
    expect(names(b, "followUps")).toEqual(["Mahesh Other Branch"]);
  });

  it("a salesperson's own name is matched word by word, not letter by letter", async () => {
    // The "a" of "Shah A" is not the one inside "Amit Shah" (Test Salesman asked about
    // "Salesman A" and got his own rows).
    const asked = await run(store.salesA, "find_followups", { salespersonName: "Shah A" });
    expect(asked.error).toBe(SALESPERSON_OWN_ONLY);
  });
});

describe("the searches", () => {
  it("find a salesperson by part of their name, and say who exists when nobody matches", async () => {
    const stats = await run(store.managerA, "get_salesperson_stats", { salespersonName: "amit" });
    expect(stats.forModel).toMatchObject({ people: [{ name: "Amit Shah", sales: 1 }] });
    const nobody = await run(store.managerA, "get_salesperson_stats", { salespersonName: "Zed" });
    expect(nobody.error).toMatch(/No staff member called "Zed". Staff: .*Amit Shah/);
  });

  it("sales: count, from follow-ups and the amount, with links to the customer", async () => {
    const sales = await run(store.managerA, "get_sales", { from: today, to: today });
    expect(sales.forModel).toMatchObject({
      salesCount: 1,
      salesFromFollowUps: 1,
      totalAmount: 1000,
    });
    expect(sales.table?.rows[0]?.href).toBe(`/customers/${mine.customer.id}`);
    // Never the customer's mobile, to the model or on screen.
    const mobile = (await db.customer.findUniqueOrThrow({ where: { id: mine.customer.id } }))
      .mobile!;
    expect(JSON.stringify(sales)).not.toContain(mobile);
  });

  it("'said they would visit' = follow-ups with method VISIT", async () => {
    const visits = await run(store.managerA, "find_followups", { method: "VISIT" });
    expect(names(visits, "followUps")).toEqual(["Ramesh Mine"]);
  });

  it(`returns at most ${ASK_MAX_ROWS} rows and says how many there were`, async () => {
    for (let i = 0; i < ASK_MAX_ROWS + 5; i++) {
      await customerWithFollowUp({
        branchId: store.branchB.id,
        assignedToId: store.managerB.id,
        name: `Bulk ${String(i).padStart(2, "0")}`,
      });
    }
    const many = await run(store.managerB, "find_followups");
    expect(many.total).toBe(ASK_MAX_ROWS + 6);
    expect(many.table?.rows).toHaveLength(ASK_MAX_ROWS);
    expect(many.forModel).toMatchObject({ total: ASK_MAX_ROWS + 6, shown: ASK_MAX_ROWS });
    expect(many.table?.note).toBe(`Showing ${ASK_MAX_ROWS} of ${ASK_MAX_ROWS + 6}`);
  }, 60_000);

  it("bad filters come back to the model as an error, not a crash", async () => {
    const actor = askActor(asUser(store.managerA), branchOf(store.managerA), now, "en");
    const t = await askText("en");
    expect((await runAskTool("find_followups", "{not json", actor, t)).error).toMatch(/JSON/);
    expect((await runAskTool("drop_tables", "{}", actor, t)).error).toMatch(/No search/);
    const backwards = await runAskTool(
      "get_sales",
      JSON.stringify({ from: "2026-09-30", to: "2026-09-01" }),
      actor,
      t,
    );
    expect(backwards.error).toMatch(/ends before/);
  });
});

describe("read-only (BR-17, M21 'Done when')", () => {
  const counts = () =>
    Promise.all([
      db.customer.count(),
      db.enquiry.count(),
      db.visit.count(),
      db.followUp.count(),
      db.sale.count(),
      db.timelineEvent.count(),
      db.auditLog.count(),
      db.user.count(),
      db.setting.count(),
      db.aiQuestionLog.count(),
      db.aiSuggestionLog.count(),
    ]);

  it("no search changes any table, for any role", async () => {
    const snapshot = async () =>
      Promise.all([
        counts(),
        db.followUp.findMany({ select: { id: true, status: true, updatedAt: true } }),
        db.customer.findMany({ select: { id: true, updatedAt: true }, take: 500 }),
      ]);
    const before = await snapshot();
    const everything = {
      from: "2026-01-01",
      to: today,
      salespersonName: "Amit",
      categoryNames: ["Sherwani"],
      notContactedDays: 7,
      hasOpenEnquiry: true,
    };
    for (const user of [store.salesA, store.managerA, store.admin]) {
      for (const tool of [
        "find_followups",
        "find_customers",
        "get_sales",
        "get_salesperson_stats",
        "get_lost_reasons",
        "get_dashboard",
      ]) {
        await run(user, tool, {});
        await run(user, tool, everything);
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it("asking writes exactly one row: the question log", async () => {
    let round = 0;
    const provider: AiProvider = {
      fill: async () => ({}),
      transcribe: async () => ({ text: "" }),
      chat: async ({ onText }) => {
        round += 1;
        if (round === 1) {
          onText?.("Let me check. ");
          return {
            text: "Let me check. ",
            toolCalls: [{ id: "c1", name: "find_followups", arguments: "{}" }],
          };
        }
        onText?.("You have 1 follow-up today.");
        return { text: "You have 1 follow-up today.", toolCalls: [] };
      },
    };
    const events: AskEvent[] = [];
    const before = await counts();
    const result = await askCore("who today?", asUser(store.salesA), {
      provider,
      now,
      scope: branchOf(store.salesA),
      branchLabel: store.branchA.name,
      storeName: "Test Store",
      locale: "en",
      emit: (event) => events.push(event),
    });
    const after = await counts();
    // Only the question log (index 9) grew, by one.
    expect(after.map((n, i) => n - before[i]!)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);

    expect(events.map((event) => event.type)).toEqual([
      "text",
      "reset",
      "tool",
      "tables",
      "text",
      "done",
    ]);
    const tables = events.find((event) => event.type === "tables");
    expect(tables).toMatchObject({ tables: [{ key: "followUps" }] });
    expect(tables?.type === "tables" && tables.tables[0]?.rows[0]).toMatchObject({
      cells: ["Ramesh Mine", expect.any(String), "Evening", "Customer will visit", "Wedding"],
      href: `/customers/${mine.customer.id}`,
    });
    const row = await db.aiQuestionLog.findUniqueOrThrow({ where: { id: result!.questionId } });
    expect(row).toMatchObject({
      userId: store.salesA.id,
      question: "who today?",
      answer: "You have 1 follow-up today.",
      markedWrong: false,
    });
    expect(row.toolsUsed).toMatchObject({
      calls: [{ name: "find_followups", args: {}, total: 1 }],
    });
  });

  it("a model failure is one message; the question is still logged", async () => {
    const provider: AiProvider = {
      fill: async () => ({}),
      transcribe: async () => ({ text: "" }),
      chat: async () => {
        throw new Error("boom");
      },
    };
    const events: AskEvent[] = [];
    const result = await askCore("anything", asUser(store.managerA), {
      provider,
      now,
      scope: branchOf(store.managerA),
      branchLabel: "A",
      storeName: "Test Store",
      locale: "en",
      emit: (event) => events.push(event),
    });
    expect(result).toBeNull();
    expect(events).toEqual([{ type: "error", message: "ask.errors.failed" }]);
    const row = await db.aiQuestionLog.findFirstOrThrow({ where: { userId: store.managerA.id } });
    expect(row.toolsUsed).toMatchObject({ failure: "error" });
  });
});

describe("switch, limit, marking wrong, first-time questions", () => {
  it("the admin's switch and the daily limit are checked before answering", async () => {
    await setAi(false);
    await expect(askPreflight(asUser(store.salesA), now)).rejects.toMatchObject({
      message: "ai.errors.off",
    });
    await setAi(true, 1);
    await expect(askPreflight(asUser(store.salesA), now)).resolves.toBeUndefined();
    await db.aiQuestionLog.create({
      data: { userId: store.salesA.id, question: "q", toolsUsed: {}, answer: "a" },
    });
    await expect(askPreflight(asUser(store.salesA), now)).rejects.toMatchObject({
      message: "ai.errors.limit",
      values: { limit: 1 },
    });
  });

  it("'Was this wrong?' marks one's own answer only", async () => {
    const own = await db.aiQuestionLog.create({
      data: { userId: store.salesA.id, question: "q", toolsUsed: {}, answer: "a" },
    });
    await expect(markAnswerWrongCore(own.id, asUser(store.salesB))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await markAnswerWrongCore(own.id, asUser(store.salesA));
    expect((await db.aiQuestionLog.findUniqueOrThrow({ where: { id: own.id } })).markedWrong).toBe(
      true,
    );
  });

  it("suggested questions stop after the first few", async () => {
    expect(await isFirstTimeAsker(store.managerB.id)).toBe(true);
    for (let i = 0; i < 3; i++) {
      await db.aiQuestionLog.create({
        data: { userId: store.managerB.id, question: "q", toolsUsed: {}, answer: "a" },
      });
    }
    expect(await isFirstTimeAsker(store.managerB.id)).toBe(false);
  });
});

describe("R11 AI usage", () => {
  it("counts fills, accepted fills, questions and wrong answers per person in the branch", async () => {
    await db.aiSuggestionLog.createMany({
      data: [
        { userId: store.salesA.id, screen: "visit", inputText: "n", output: {}, accepted: true },
        { userId: store.salesA.id, screen: "visit", inputText: "n", output: {}, accepted: false },
        { userId: store.salesB.id, screen: "visit", inputText: "n", output: {}, accepted: true },
      ],
    });
    await db.aiQuestionLog.createMany({
      data: [
        { userId: store.salesA.id, question: "q", toolsUsed: {}, answer: "a", markedWrong: true },
        { userId: store.salesA.id, question: "q", toolsUsed: {}, answer: "a" },
      ],
    });
    await signInAs(store.managerA.mobile);
    const manager = await requireUser();
    const ran = await runReport(manager, "r11", { from: today, to: today }, "en");
    const rows = ran!.result.tables[0]!.rows.map((row) => row.cells);
    expect(rows).toContainEqual({
      staff: "Amit Shah",
      aiFills: 2,
      acceptedPercent: 50,
      questions: 2,
      markedWrong: 1,
    });
    // Priya works in branch B: not in manager A's report.
    expect(rows.map((row) => row.staff)).not.toContain("Priya Patel");
    await signInAs(store.salesA.mobile);
    expect(await runReport(await requireUser(), "r11", {}, "en")).toBeNull();
  });
});
