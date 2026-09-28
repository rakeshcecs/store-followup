// M21 "Ask": a question goes to the model with the read-only searches of ask-tools.ts; the
// model picks searches, the app runs them with the asker's permissions, and the model
// writes a short answer from what came back. The rows themselves become the table under
// the answer. One AiQuestionLog row records the question, the searches with their filters,
// and the answer (M21.06). Nothing else is written (BR-17, BR-18).
//
// branch-scope-exempt: the searches apply the scope themselves (ask-tools.ts); here only
// the log table and the category names for the prompt are read.
import type { Locale } from "@/i18n/config";
import type { SessionUser } from "@/lib/auth";
import { buildAskPrompt } from "@/lib/ai/ask-prompt";
import {
  askText,
  askToolsFor,
  runAskTool,
  type AskActor,
  type AskText,
  type ToolOutcome,
} from "@/lib/ai/ask-tools";
import {
  AiProviderError,
  aiConfigured,
  type AiProvider,
  type ChatMessage,
} from "@/lib/ai/provider";
import { istDayStart } from "@/lib/ai/suggest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isoDate } from "@/lib/format";
import { logger } from "@/lib/logger";
import { accessScope, branchWhereShared, type BranchScope } from "@/lib/permissions";
import { aiDailyLimit, aiEnabled } from "@/lib/settings";
import { staffBranchWhere } from "@/lib/staff-scope";
import type { AskEvent, AskTable } from "@/lib/validation/ai";

// SOW NFR: "AI answers within 10 seconds". The hard stop leaves room for a slow network
// on top of two rounds of searches.
export const ASK_TIMEOUT_MS = 20_000;
// Search rounds before the model must answer with what it has.
export const ASK_MAX_ROUNDS = 3;

export type AskContext = {
  provider: AiProvider;
  now: Date;
  scope: BranchScope; // the switcher's branches (a salesperson's are replaced by their own)
  branchLabel: string;
  storeName: string;
  locale: Locale;
  emit: (event: AskEvent) => void;
  runTool?: typeof runAskTool; // tests hand in canned search results
};

export type ToolUse = { name: string; args: unknown; total: number; error?: string };

// Checked before the answer starts streaming, so the screen gets a plain error instead.
export async function askPreflight(user: SessionUser, now: Date): Promise<void> {
  if (!(await aiEnabled())) throw new AppError("RULE", { message: "ai.errors.off" });
  if (!aiConfigured()) throw new AppError("RULE", { message: "ai.errors.unavailable" });
  const [limit, used] = await Promise.all([
    aiDailyLimit(),
    db.aiQuestionLog.count({ where: { userId: user.id, createdAt: { gte: istDayStart(now) } } }),
  ]);
  if (used >= limit) throw new AppError("RULE", { message: "ai.errors.limit", values: { limit } });
}

// A salesperson's searches cover every branch they work in, like "My figures" (M13.03);
// everyone else's cover the branches in the switcher.
export function askActor(
  user: SessionUser,
  scope: BranchScope,
  now: Date,
  locale: Locale,
): AskActor {
  const self = user.role === "SALESPERSON" ? user.id : null;
  return {
    user,
    self,
    scope: self ? accessScope(user) : scope,
    today: isoDate(now),
    locale,
  };
}

const parseArgs = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

export async function askCore(
  question: string,
  user: SessionUser,
  ctx: AskContext,
): Promise<{ questionId: string } | null> {
  const started = Date.now();
  const actor = askActor(user, ctx.scope, ctx.now, ctx.locale);
  const runTool = ctx.runTool ?? runAskTool;
  const [t, staff, categories] = await Promise.all([
    askText(ctx.locale),
    actor.self
      ? []
      : db.user.findMany({
          // The people a manager asks about: active salespeople and managers.
          where: {
            ...staffBranchWhere(actor.scope),
            role: { in: ["SALESPERSON", "MANAGER"] },
            status: "ACTIVE",
          },
          select: { fullName: true },
          orderBy: { fullName: "asc" },
        }),
    db.requirementCategory.findMany({
      where: { active: true, ...branchWhereShared(actor.scope) },
      select: { nameEn: true, nameHi: true, nameGu: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      take: 40,
    }),
  ]);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAskPrompt({
        today: actor.today,
        storeName: ctx.storeName,
        role: user.role,
        branchLabel: ctx.branchLabel,
        language: user.language,
        staffNames: staff.map((person) => person.fullName),
        categories,
      }),
    },
    { role: "user", content: question },
  ];
  const tools = askToolsFor(user.role);
  const calls: ToolUse[] = [];
  const signal = AbortSignal.timeout(ASK_TIMEOUT_MS);
  let answer = "";
  let failure: string | null = null;

  try {
    for (let round = 0; round < ASK_MAX_ROUNDS; round++) {
      // The last round offers no searches, so the model has to answer.
      const offered = round < ASK_MAX_ROUNDS - 1 ? tools : [];
      let streamed = false;
      const turn = await ctx.provider.chat({
        messages,
        tools: offered,
        signal,
        onText: (delta) => {
          streamed = true;
          ctx.emit({ type: "text", delta });
        },
      });
      if (turn.toolCalls.length === 0) {
        answer = turn.text.trim();
        break;
      }
      // "Let me check…" written before a search is not the answer.
      if (streamed) ctx.emit({ type: "reset" });
      messages.push({ role: "assistant", content: turn.text || null, toolCalls: turn.toolCalls });
      const outcomes: ToolOutcome[] = [];
      for (const call of turn.toolCalls) {
        ctx.emit({ type: "tool", name: call.name });
        const outcome = await runTool(call.name, call.arguments, actor, t as AskText);
        outcomes.push(outcome);
        calls.push({
          name: call.name,
          args: parseArgs(call.arguments),
          total: outcome.total,
          ...(outcome.error ? { error: outcome.error } : {}),
        });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify(outcome.forModel),
        });
      }
      const tables = outcomes
        .map((outcome) => outcome.table)
        .filter((table): table is AskTable => table !== null && table.rows.length > 0);
      ctx.emit({ type: "tables", tables });
    }
    if (!answer) failure = "empty";
  } catch (error) {
    failure = error instanceof AiProviderError ? error.kind : "error";
    if (!(error instanceof AiProviderError)) logger.error("ai.ask_failed", error);
  }

  const ms = Date.now() - started;
  logger.info("ai.ask_done", { ms, calls: calls.length, failure });
  const row = await db.aiQuestionLog.create({
    data: {
      userId: user.id,
      question,
      toolsUsed: { calls, ms, ...(failure ? { failure } : {}) } as never,
      answer,
    },
    select: { id: true },
  });
  if (failure) {
    ctx.emit({ type: "error", message: "ask.errors.failed" });
    return null;
  }
  ctx.emit({ type: "done", questionId: row.id });
  return { questionId: row.id };
}

// "Was this wrong?" (M21.06): only on one's own answers.
export async function markAnswerWrongCore(questionId: string, user: SessionUser): Promise<void> {
  const { count } = await db.aiQuestionLog.updateMany({
    where: { id: questionId, userId: user.id },
    data: { markedWrong: true },
  });
  if (count === 0) throw new AppError("NOT_FOUND");
}

// Suggested questions (M21.07) are for people who have asked fewer than this many.
export const FIRST_TIME_QUESTIONS = 3;

export async function isFirstTimeAsker(userId: string): Promise<boolean> {
  const asked = await db.aiQuestionLog.count({ where: { userId } });
  return asked < FIRST_TIME_QUESTIONS;
}
