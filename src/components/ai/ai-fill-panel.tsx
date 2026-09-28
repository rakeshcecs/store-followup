"use client";

import { Mic, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { TextArea } from "@/components/ui/text-area";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useOnline } from "@/hooks/use-online";
import { useRecorder } from "@/hooks/use-recorder";
import type { AiSuggestion } from "@/lib/ai/check";
import { suggestFields } from "@/lib/actions/ai";
import { AI_AUDIO_MAX_SECONDS, AI_NOTE_MAX, type AiScreen } from "@/lib/validation/ai";
import { cn } from "@/lib/utils";

type AiFillPanelProps = {
  screen: AiScreen;
  customerId: string;
  enabled: boolean; // the admin's switch, with a key on the server
  defaultOpen?: boolean; // the profile's button lands here with the panel open
  onApply: (suggestion: AiSuggestion, suggestionId: string) => void;
};

// M20: "Ask AI to fill". One text box the person types into or talks into (hold the
// microphone), one button that sends the note and hands the checked suggestion to the
// form. Nothing is saved from here (BR-17); the form's own Save does that.
export function AiFillPanel({
  screen,
  customerId,
  enabled,
  defaultOpen,
  onApply,
}: AiFillPanelProps) {
  const t = useTranslations("ai");
  const tError = useErrorMessage();
  const online = useOnline();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [text, setText] = useState("");
  const [audioSeconds, setAudioSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [pending, startTransition] = useTransition();

  const transcribe = useCallback(
    async (audio: Blob, seconds: number) => {
      setError(null);
      setTranscribing(true);
      try {
        const form = new FormData();
        form.append("audio", audio, "note");
        form.append("seconds", String(seconds));
        const response = await fetch("/api/ai/transcribe", { method: "POST", body: form });
        const body = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!response.ok || !body.text) {
          setError(tError(body.error ?? "ai.errors.failed"));
          return;
        }
        // Spoken after typed: the words are added, not put in place of what is there.
        setText((current) => (current.trim() ? `${current.trim()} ${body.text}` : body.text!));
        setAudioSeconds((current) => (current ?? 0) + seconds);
      } catch {
        setError(tError("ai.errors.failed"));
      } finally {
        setTranscribing(false);
      }
    },
    [tError],
  );
  const onRecorderError = useCallback((key: string) => setError(tError(key)), [tError]);
  const recorder = useRecorder({
    maxSeconds: AI_AUDIO_MAX_SECONDS,
    onStop: transcribe,
    onError: onRecorderError,
  });

  // Offline there is no AI to ask (M19), so the button is not offered at all.
  if (!enabled || !online) return null;

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} data-testid="ai-ask">
        <Sparkles aria-hidden className="text-primary" />
        {t("ask")}
      </Button>
    );
  }

  function fill() {
    const note = text.trim();
    if (!note) {
      setError(tError("ai.errors.empty"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await suggestFields({
        screen,
        customerId,
        text: note,
        ...(audioSeconds !== null
          ? { audioSeconds: Math.min(audioSeconds, AI_AUDIO_MAX_SECONDS) }
          : {}),
      });
      if (!result.ok) {
        setError(tError(result.message, result.values));
        return;
      }
      onApply(result.data.suggestion, result.data.suggestionId);
      toast(t("filled"));
      setOpen(false);
      setText("");
      setAudioSeconds(null);
    });
  }

  const busy = pending || transcribing;
  const micLabel = recorder.recording
    ? t("recording", { seconds: recorder.seconds })
    : transcribing
      ? t("transcribing")
      : t("holdToTalk");

  return (
    <Card
      className="flex flex-col gap-3 border-primary/40 bg-primary-light/30 p-3.5"
      data-testid="ai-panel"
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="size-5 shrink-0 text-primary" />
        <h3 className="grow font-heading-style text-lg">{t("title")}</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("close")}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <TextArea
        label={t("note")}
        placeholder={t("placeholder")}
        hint={t("hint")}
        maxLength={AI_NOTE_MAX}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        className="min-h-24 bg-card"
      />
      <div className="flex gap-2">
        {recorder.supported && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-pressed={recorder.recording}
            data-testid="ai-mic"
            className={cn(
              "w-auto shrink-0 touch-none select-none",
              recorder.recording && "border-danger bg-danger/10 text-danger",
            )}
            onPointerDown={(event) => {
              event.preventDefault();
              void recorder.start();
            }}
            onPointerUp={recorder.stop}
            onPointerCancel={recorder.stop}
            onPointerLeave={() => recorder.recording && recorder.stop()}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              if (recorder.recording) recorder.stop();
              else void recorder.start();
            }}
          >
            <Mic aria-hidden />
            {micLabel}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={fill}
          disabled={busy || recorder.recording}
          data-testid="ai-fill"
        >
          {pending ? t("filling") : t("fill")}
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </Card>
  );
}
