// M20 "Ask AI to fill": the note goes out, a checked suggestion comes back, and one log
// row records both. Nothing here writes a customer, visit, follow-up or sale (BR-17):
// the person saves through the normal button, and recordAiOutcomeCore() only notes what
// they saved on the same log row.
//
// branch-scope-exempt: customers are shared across branches (BR-16); the categories and
// festivals are read through the scope of the branch on screen.
import type { SessionUser } from "@/lib/auth";
import {
  acceptedAsSuggested,
  checkSuggestion,
  isEmptySuggestion,
  type AiSuggestion,
} from "@/lib/ai/check";
import { buildFillPrompt, FILL_FORM_TOOL, type NamedOption } from "@/lib/ai/prompt";
import {
  AI_FILL_TIMEOUT_MS,
  AiProviderError,
  aiConfigured,
  type AiProvider,
} from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";
import { logger } from "@/lib/logger";
import { ALL_BRANCHES, branchScope, branchWhereShared, type BranchChoice } from "@/lib/permissions";
import { aiDailyLimit, aiEnabled } from "@/lib/settings";
import type { AiFinalValues, SuggestFieldsInput } from "@/lib/validation/ai";

export const FESTIVAL_HORIZON_DAYS = 90;

export type SuggestContext = {
  provider: AiProvider;
  now: Date;
  branch: BranchChoice; // the switcher's choice: which categories and festivals apply
  storeName: string;
};

export type SuggestResult = { suggestionId: string; suggestion: AiSuggestion };

// Whether a screen should offer "Ask AI to fill": the admin's switch, and a key on the
// server for it to mean anything.
export async function aiAvailable(): Promise<boolean> {
  return aiConfigured() && (await aiEnabled());
}

// Midnight IST of the day `now` falls on, as an instant: the daily limit counts from here.
export function istDayStart(now: Date): Date {
  return new Date(`${isoDate(now)}T00:00:00.000+05:30`);
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

export async function suggestFieldsCore(
  input: SuggestFieldsInput,
  user: SessionUser,
  ctx: SuggestContext,
): Promise<SuggestResult> {
  if (!(await aiEnabled())) throw new AppError("RULE", { message: "ai.errors.off" });
  if (!aiConfigured()) throw new AppError("RULE", { message: "ai.errors.unavailable" });

  const [limit, used] = await Promise.all([
    aiDailyLimit(),
    db.aiSuggestionLog.count({
      where: { userId: user.id, createdAt: { gte: istDayStart(ctx.now) } },
    }),
  ]);
  if (used >= limit) throw new AppError("RULE", { message: "ai.errors.limit", values: { limit } });

  // Only what the prompt needs: the first name and the enquiry title. The mobile and the
  // address are not even selected.
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, active: true },
    select: { name: true, enquiries: { where: { status: "OPEN" }, select: { title: true } } },
  });
  if (!customer) throw new AppError("NOT_FOUND");

  const today = isoDate(ctx.now);
  // An admin on "All branches" sees every branch's categories: the form itself asks them
  // to pick a branch before anything can be saved.
  const scope = branchScope(user, ctx.branch === ALL_BRANCHES ? undefined : ctx.branch);
  const shared = branchWhereShared(scope);
  const select = { id: true, nameEn: true, nameHi: true, nameGu: true } as const;
  const [categories, reasons, festivals] = await Promise.all([
    db.requirementCategory.findMany({
      where: { active: true, ...shared },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select,
    }),
    db.lostReason.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select,
    }),
    db.festival.findMany({
      where: {
        active: true,
        date: { gte: calendarDay(today), lte: calendarDay(addDays(today, FESTIVAL_HORIZON_DAYS)) },
        ...shared,
      },
      orderBy: { date: "asc" },
      select: { name: true, date: true },
    }),
  ]);

  const prompt = buildFillPrompt({
    screen: input.screen,
    storeName: ctx.storeName,
    today,
    festivals: festivals.map((f) => ({ name: f.name, date: f.date.toISOString().slice(0, 10) })),
    categories: categories as NamedOption[],
    reasons: reasons as NamedOption[],
    customerFirstName: firstName(customer.name),
    enquiryTitle: customer.enquiries[0]?.title ?? null,
    language: user.language,
    text: input.text,
  });

  const started = Date.now();
  let output: unknown;
  try {
    output = await ctx.provider.fill({
      ...prompt,
      tool: FILL_FORM_TOOL,
      timeoutMs: AI_FILL_TIMEOUT_MS,
    });
  } catch (error) {
    const kind = error instanceof AiProviderError ? error.kind : "unknown";
    logger.warn("ai.fill_failed", { kind, ms: Date.now() - started, screen: input.screen });
    throw new AppError("RULE", { message: "ai.errors.failed" });
  }
  const ms = Date.now() - started;

  const suggestion = checkSuggestion(output, {
    screen: input.screen,
    today,
    categoryIds: new Set(categories.map((c) => c.id)),
    reasonIds: new Set(reasons.map((r) => r.id)),
  });
  if (isEmptySuggestion(suggestion)) {
    logger.info("ai.fill_empty", { ms, screen: input.screen });
    throw new AppError("RULE", { message: "ai.errors.nothing" });
  }

  // M20.07: the note, the answer as the form received it, and the raw answer for tuning.
  const log = await db.aiSuggestionLog.create({
    data: {
      userId: user.id,
      screen: input.screen,
      inputText: input.text,
      audioSeconds: input.audioSeconds ?? null,
      output: JSON.parse(JSON.stringify({ suggestion, raw: output, ms })),
    },
    select: { id: true },
  });
  logger.info("ai.fill_done", { ms, screen: input.screen, check: suggestion.check.length });
  return { suggestionId: log.id, suggestion };
}

// Called by the form after its normal Save succeeded: what was kept, what was changed.
export async function recordAiOutcomeCore(
  suggestionId: string,
  finalValues: AiFinalValues,
  user: SessionUser,
): Promise<{ accepted: boolean }> {
  const log = await db.aiSuggestionLog.findFirst({
    where: { id: suggestionId, userId: user.id },
    select: { id: true, output: true },
  });
  if (!log) throw new AppError("NOT_FOUND");
  const stored = log.output as { suggestion?: AiSuggestion } | null;
  const accepted = stored?.suggestion
    ? acceptedAsSuggested(stored.suggestion, finalValues as Record<string, unknown>)
    : false;
  await db.aiSuggestionLog.update({
    where: { id: log.id },
    data: { finalValues: JSON.parse(JSON.stringify(finalValues)), accepted },
  });
  return { accepted };
}
