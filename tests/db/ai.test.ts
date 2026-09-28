import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { recordAiOutcomeCore, suggestFieldsCore } = await import("@/lib/ai/suggest");
const { updateAiSettings } = await import("@/lib/actions/settings");
const { AUDIT } = await import("@/lib/audit");
const { db } = await import("@/lib/db");
const { AppError } = await import("@/lib/errors");
const { aiDailyLimit, aiEnabled, SETTING } = await import("@/lib/settings");
const { makeCustomer } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs } = await import("../helpers/session");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
type SessionUser = import("@/lib/auth").SessionUser;
type AiProvider = import("@/lib/ai/provider").AiProvider;

// M20 with a fake model: the switch, the daily limit, the log row, and the rule that the
// AI touches no business table (BR-17). Two branches, two managers, two salespeople and
// an admin, every time.

let store: TestStore;
let customer: Awaited<ReturnType<typeof makeCustomer>>;
let sherwani: string;

const now = new Date();

// A model that always plans the same Saturday call. `calls` records what it was told.
function fakeProvider(answer: Record<string, unknown>, calls: string[] = []): AiProvider {
  return {
    fill: async ({ system, user }) => {
      calls.push(system, user);
      return answer;
    },
    transcribe: async () => ({ text: "" }),
    chat: async () => ({ text: "", toolCalls: [] }),
  };
}

const goodAnswer = () => ({
  categoryIds: [sherwani, "made-up"],
  expectedPurchase: null,
  remarks: "Liked the sherwani, will come Sunday",
  outcome: "DECIDE_LATER",
  lostReasonId: null,
  contact: { date: "2099-01-02", timeSlot: "EVENING", method: "CALL", reason: "Confirm" },
  visit: { date: "2099-01-03", timeSlot: null },
  result: null,
  intent: "WARM",
  confidence: { categoryIds: 0.9, remarks: 0.9, outcome: 0.8, contact: 0.5, intent: 0.7 },
});

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

const ctx = (provider: AiProvider, branch?: string) => ({
  provider,
  now,
  branch: branch ?? store.branchA.id,
  storeName: "Test Store",
});

async function setAi(enabled: boolean, dailyLimit = 100) {
  await db.setting.upsert({
    where: { key: SETTING.aiEnabled },
    create: { key: SETTING.aiEnabled, value: enabled },
    update: { value: enabled },
  });
  await db.setting.upsert({
    where: { key: SETTING.aiDailyLimit },
    create: { key: SETTING.aiDailyLimit, value: dailyLimit },
    update: { value: dailyLimit },
  });
}

beforeEach(async () => {
  process.env["OPENAI_API_KEY"] = process.env["OPENAI_API_KEY"] || "test-key";
  store = await makeStore();
  customer = await makeCustomer(store.branchA.id, store.salesA.id);
  sherwani = (
    await db.requirementCategory.create({
      data: { nameEn: "Sherwani", nameHi: "शेरवानी", nameGu: "શેરવાની", sortOrder: 1 },
    })
  ).id;
  await setAi(true);
});

afterAll(() => db.$disconnect());

describe("suggestFieldsCore", () => {
  it("refuses while the admin has it switched off", async () => {
    await setAi(false);
    await expect(
      suggestFieldsCore(
        { screen: "visit", customerId: customer.id, text: "note" },
        asUser(store.salesA),
        ctx(fakeProvider(goodAnswer())),
      ),
    ).rejects.toMatchObject({ code: "RULE", message: "ai.errors.off" });
  });

  it("checks the answer, logs it, and writes nothing else", async () => {
    const before = await Promise.all([
      db.customer.count(),
      db.visit.count(),
      db.followUp.count(),
      db.enquiry.count(),
      db.sale.count(),
    ]);
    const calls: string[] = [];
    const result = await suggestFieldsCore(
      {
        screen: "visit",
        customerId: customer.id,
        text: "Sunday aayega, Saturday call",
        audioSeconds: 7,
      },
      asUser(store.salesA),
      ctx(fakeProvider(goodAnswer(), calls)),
    );

    expect(result.suggestion).toEqual({
      categoryIds: [sherwani], // the made-up id is gone
      remarks: "Liked the sherwani, will come Sunday",
      outcome: "DECIDE_LATER",
      followUp: { date: "2099-01-02", timeSlot: "EVENING", method: "CALL", reason: "Confirm" },
      intent: "WARM",
      check: ["followUp"], // contact confidence 0.5
    });

    const log = await db.aiSuggestionLog.findUniqueOrThrow({ where: { id: result.suggestionId } });
    expect(log).toMatchObject({
      userId: store.salesA.id,
      screen: "visit",
      inputText: "Sunday aayega, Saturday call",
      audioSeconds: 7,
      accepted: false,
      finalValues: null,
    });

    // BR-17: no customer, visit, follow-up, enquiry or sale appeared.
    const after = await Promise.all([
      db.customer.count(),
      db.visit.count(),
      db.followUp.count(),
      db.enquiry.count(),
      db.sale.count(),
    ]);
    expect(after).toEqual(before);

    // Privacy: the first name and the category list went out; the mobile did not.
    const sent = calls.join("\n");
    expect(sent).toContain(customer.name.split(" ")[0]);
    expect(sent).toContain(sherwani);
    expect(sent).not.toContain(customer.mobile);
  });

  it("stops at the daily limit, counted from midnight IST", async () => {
    await setAi(true, 2);
    const user = asUser(store.salesB);
    const input = { screen: "followUp" as const, customerId: customer.id, text: "call tomorrow" };
    const c = ctx(fakeProvider(goodAnswer()), store.branchB.id);
    await suggestFieldsCore(input, user, c);
    await suggestFieldsCore(input, user, c);
    await expect(suggestFieldsCore(input, user, c)).rejects.toMatchObject({
      code: "RULE",
      message: "ai.errors.limit",
      values: { limit: 2 },
    });
    // Yesterday's fills do not count.
    await db.aiSuggestionLog.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
    });
    await expect(suggestFieldsCore(input, user, c)).resolves.toBeTruthy();
    // Someone else's fills never count against this person.
    expect(await db.aiSuggestionLog.count({ where: { userId: store.salesA.id } })).toBe(0);
  });

  it("a model failure or an empty answer is a RULE the form can show; nothing is logged", async () => {
    const failing: AiProvider = {
      fill: async () => {
        throw new Error("boom");
      },
      transcribe: async () => ({ text: "" }),
      chat: async () => ({ text: "", toolCalls: [] }),
    };
    await expect(
      suggestFieldsCore(
        { screen: "visit", customerId: customer.id, text: "note" },
        asUser(store.salesA),
        ctx(failing),
      ),
    ).rejects.toMatchObject({ code: "RULE", message: "ai.errors.failed" });
    const empty = {
      ...goodAnswer(),
      categoryIds: [],
      remarks: null,
      outcome: null,
      contact: null,
      visit: null,
      intent: null,
    };
    await expect(
      suggestFieldsCore(
        { screen: "visit", customerId: customer.id, text: "note" },
        asUser(store.salesA),
        ctx(fakeProvider(empty)),
      ),
    ).rejects.toMatchObject({ code: "RULE", message: "ai.errors.nothing" });
    expect(await db.aiSuggestionLog.count({ where: { userId: store.salesA.id } })).toBe(0);
  });

  it("an inactive or unknown customer is not found", async () => {
    await db.customer.update({ where: { id: customer.id }, data: { active: false } });
    await expect(
      suggestFieldsCore(
        { screen: "visit", customerId: customer.id, text: "note" },
        asUser(store.salesA),
        ctx(fakeProvider(goodAnswer())),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("recordAiOutcomeCore", () => {
  it("marks the suggestion accepted only when it was saved as it was", async () => {
    const user = asUser(store.salesA);
    const c = ctx(fakeProvider(goodAnswer()));
    const kept = await suggestFieldsCore(
      { screen: "visit", customerId: customer.id, text: "n" },
      user,
      c,
    );
    const changed = await suggestFieldsCore(
      { screen: "visit", customerId: customer.id, text: "n" },
      user,
      c,
    );

    const saved = {
      categoryIds: [sherwani],
      remarks: "Liked the sherwani, will come Sunday",
      outcome: "DECIDE_LATER" as const,
      intent: "WARM" as const,
      followUp: {
        date: "2099-01-02",
        timeSlot: "EVENING" as const,
        method: "CALL" as const,
        reason: "Confirm visit",
      },
    };
    expect(await recordAiOutcomeCore(kept.suggestionId, saved, user)).toEqual({ accepted: true });
    expect(
      await recordAiOutcomeCore(changed.suggestionId, { ...saved, intent: "HOT" }, user),
    ).toEqual({
      accepted: false,
    });

    const rows = await db.aiSuggestionLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.accepted)).toEqual([true, false]);
    expect(rows[1]?.finalValues).toMatchObject({ intent: "HOT" });
  });

  it("only the person who asked can report on their suggestion", async () => {
    const mine = await suggestFieldsCore(
      { screen: "visit", customerId: customer.id, text: "n" },
      asUser(store.salesA),
      ctx(fakeProvider(goodAnswer())),
    );
    await expect(
      recordAiOutcomeCore(mine.suggestionId, { intent: "HOT" }, asUser(store.salesB)),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("updateAiSettings", () => {
  it("is admin only", async () => {
    await signInAs(store.managerA.mobile);
    const result = await updateAiSettings({ enabled: "on", dailyLimit: "50" });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("writes both values with one audit row each, and nothing when nothing changed", async () => {
    await setAi(false, 100);
    await signInAs(store.admin.mobile);
    const result = await updateAiSettings({ enabled: "on", dailyLimit: "25" });
    expect(result).toEqual({ ok: true, data: { saved: true } });
    expect(await aiEnabled()).toBe(true);
    expect(await aiDailyLimit()).toBe(25);

    const audits = await db.auditLog.findMany({
      where: { userId: store.admin.id, action: AUDIT.settingUpdate },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((row) => [row.entityId, row.oldValue, row.newValue])).toEqual([
      [SETTING.aiEnabled, false, true],
      [SETTING.aiDailyLimit, 100, 25],
    ]);

    await updateAiSettings({ enabled: "on", dailyLimit: "25" });
    expect(
      await db.auditLog.count({ where: { userId: store.admin.id, action: AUDIT.settingUpdate } }),
    ).toBe(2);

    expect(await updateAiSettings({ enabled: "on", dailyLimit: "0" })).toMatchObject({
      ok: false,
      code: "VALIDATION",
      field: "dailyLimit",
    });
  });

  it("a missing or damaged row falls back to off and 100", async () => {
    await db.setting.deleteMany({
      where: { key: { in: [SETTING.aiEnabled, SETTING.aiDailyLimit] } },
    });
    expect(await aiEnabled()).toBe(false);
    expect(await aiDailyLimit()).toBe(100);
    await db.setting.create({ data: { key: SETTING.aiDailyLimit, value: 5000 } });
    expect(await aiDailyLimit()).toBe(100);
  });
});
