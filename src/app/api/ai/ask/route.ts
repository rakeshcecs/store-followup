import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import { askCore, askPreflight } from "@/lib/ai/ask";
import { aiProvider } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { getBranchScope, getCurrentBranch, getCurrentBranchName } from "@/lib/current-branch";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ALL_BRANCHES } from "@/lib/permissions";
import { askInput, type AskEvent } from "@/lib/validation/ai";

// M21: a question in, the answer streamed out as newline-delimited JSON (AskEvent): which
// search is running, the answer's words as they are written, the tables, and the log id
// for "Was this wrong?". A Route Handler because a Server Action cannot stream.

export const dynamic = "force-dynamic";

const reply = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL";
    return reply({ error: "errors.unauthenticated" }, code === "UNAUTHENTICATED" ? 401 : 403);
  }

  const parsed = askInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return reply({ error: parsed.error.issues[0]?.message ?? "ask.errors.empty" }, 400);
  }

  const now = new Date();
  try {
    await askPreflight(user, now);
  } catch (error) {
    if (error instanceof AppError) {
      return reply({ error: error.message, values: error.values }, 403);
    }
    throw error;
  }

  const [scope, choice, tApp, tAsk, locale] = await Promise.all([
    getBranchScope(user),
    getCurrentBranch(user),
    getTranslations("app"),
    getTranslations("ask"),
    getLocale(),
  ]);
  const branchLabel =
    choice === ALL_BRANCHES ? tAsk("allBranches") : ((await getCurrentBranchName(choice)) ?? "");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AskEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The person left the screen; the answer is still logged.
        }
      };
      try {
        await askCore(parsed.data.question, user, {
          provider: aiProvider(),
          now,
          scope,
          branchLabel,
          storeName: tApp("storeName"),
          locale: locale as Locale,
          emit,
        });
      } catch (error) {
        logger.error("ai.ask_route_failed", error);
        emit({ type: "error", message: "ask.errors.failed" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by a disconnect
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no", // nginx: pass each line through as it comes
    },
  });
}
