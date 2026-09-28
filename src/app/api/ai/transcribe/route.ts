import { getTranslations } from "next-intl/server";
import { isHintEcho, transcribePrompt } from "@/lib/ai/prompt";
import { aiConfigured, aiProvider } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { aiEnabled } from "@/lib/settings";
import { AI_AUDIO_MAX_SECONDS } from "@/lib/validation/ai";

// M20 step 1: the spoken note becomes text. The text comes back to the phone for the
// person to read and correct before it goes anywhere else; the audio is not kept.
// A Route Handler, not a Server Action: the body is a file.

export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024; // a minute of compressed speech is well under this

const reply = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  let userLanguage: "en" | "hi" | "gu";
  try {
    userLanguage = (await requireUser()).language;
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL";
    return reply({ error: "errors.unauthenticated" }, code === "UNAUTHENTICATED" ? 401 : 403);
  }
  if (!(await aiEnabled())) return reply({ error: "ai.errors.off" }, 403);
  if (!aiConfigured()) return reply({ error: "ai.errors.unavailable" }, 503);

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  const seconds = Number(form?.get("seconds"));
  if (!(audio instanceof Blob) || audio.size === 0)
    return reply({ error: "ai.errors.noAudio" }, 400);
  if (audio.size > MAX_BYTES || seconds > AI_AUDIO_MAX_SECONDS + 1) {
    return reply({ error: "ai.errors.audioTooLong" }, 413);
  }

  const [tApp, categories] = await Promise.all([
    getTranslations("app"),
    db.requirementCategory.findMany({
      where: { active: true },
      select: { id: true, nameEn: true, nameHi: true, nameGu: true },
      take: 30,
    }),
  ]);

  const started = Date.now();
  try {
    const extension = audio.type.includes("mp4")
      ? "mp4"
      : audio.type.includes("ogg")
        ? "ogg"
        : "webm";
    const prompt = transcribePrompt(tApp("storeName"), categories);
    const { text } = await aiProvider().transcribe({
      audio,
      fileName: `note.${extension}`,
      language: userLanguage,
      prompt,
    });
    // A clip with nothing said in it comes back as the hint: that is not the note.
    const echo = isHintEcho(text, prompt);
    logger.info("ai.transcribe_done", {
      ms: Date.now() - started,
      chars: text.length,
      bytes: audio.size,
      type: audio.type,
      seconds,
      echo,
    });
    if (!text || echo) return reply({ error: "ai.errors.nothingHeard" }, 422);
    return reply({ text });
  } catch (error) {
    logger.warn("ai.transcribe_failed", { ms: Date.now() - started, error: String(error) });
    return reply({ error: "ai.errors.failed" }, 502);
  }
}
