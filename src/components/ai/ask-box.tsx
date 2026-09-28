"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { TextInput } from "@/components/ui/text-input";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useOnline } from "@/hooks/use-online";
import { markAnswerWrong } from "@/lib/actions/ai";
import { cn } from "@/lib/utils";
import { ASK_QUESTION_MAX, type AskEvent, type AskTable } from "@/lib/validation/ai";

type AskBoxProps = {
  suggestions: string[]; // M21.07: shown to first-time askers only
};

// M21: the "Ask" box. The question goes to /api/ai/ask and the answer streams back: which
// search is running, then the short answer as it is written, then the rows as tables with
// every customer linking to their profile. The AI only reads (BR-18); nothing here saves.
export function AskBox({ suggestions }: AskBoxProps) {
  const t = useTranslations("ask");
  const tError = useErrorMessage();
  const online = useOnline();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [tables, setTables] = useState<AskTable[]>([]);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState<"no" | "saving" | "done">("no");
  const [, startTransition] = useTransition();
  const [asked, setAsked] = useState(false);

  // Offline there is no AI to ask (M19).
  if (!online) return null;

  function handle(line: string) {
    if (!line.trim()) return;
    let event: AskEvent;
    try {
      event = JSON.parse(line) as AskEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case "tool":
        setPhase(t(`looking.${event.name}` as "looking.find_followups"));
        break;
      case "text":
        setPhase(null);
        setAnswer((current) => current + event.delta);
        break;
      case "reset":
        setAnswer("");
        break;
      case "tables":
        setTables(event.tables);
        break;
      case "done":
        setQuestionId(event.questionId);
        break;
      case "error":
        setError(tError(event.message, event.values));
        break;
    }
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q) {
      setError(tError("ask.errors.empty"));
      return;
    }
    setAsked(true);
    setQuestion(q);
    setBusy(true);
    setPhase(t("thinking"));
    setAnswer("");
    setTables([]);
    setQuestionId(null);
    setError(null);
    setWrong("no");
    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          values?: Record<string, string | number>;
        };
        setError(tError(body.error ?? "ask.errors.failed", body.values));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handle);
      }
      handle(buffer);
    } catch {
      setError(tError("ask.errors.failed"));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  function markWrong() {
    if (!questionId) return;
    setWrong("saving");
    startTransition(async () => {
      const result = await markAnswerWrong({ questionId });
      setWrong(result.ok ? "done" : "no");
      if (!result.ok) setError(tError(result.message, result.values));
    });
  }

  return (
    <Card
      className="flex flex-col gap-3 border-primary/40 bg-primary-light/30 p-3.5"
      data-testid="ask-box"
    >
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <TextInput
          label={
            <span className="flex items-center gap-1.5">
              <Sparkles aria-hidden className="size-4 text-primary" />
              {t("label")}
            </span>
          }
          name="question"
          placeholder={t("placeholder")}
          hint={t("hint")}
          maxLength={ASK_QUESTION_MAX}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={busy}
          autoComplete="off"
          className="bg-card"
          data-testid="ask-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="ask-send">
          {busy ? t("asking") : t("send")}
        </Button>
      </form>

      {!asked && suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="ask-suggestions">
          <p className="text-sm font-bold text-muted-foreground">{t("suggested")}</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void ask(suggestion)}
                disabled={busy}
                className="min-h-11 rounded-full border border-border bg-card px-3.5 py-2 text-left text-sm hover:bg-black/5"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase && (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="ask-phase"
        >
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {phase}
        </p>
      )}

      {answer && (
        <p
          className="text-[17px] leading-relaxed whitespace-pre-wrap"
          aria-live="polite"
          data-testid="ask-answer"
        >
          {answer}
        </p>
      )}

      {tables.map((table) => (
        <AnswerTable key={table.key + table.title} table={table} />
      ))}

      {questionId && (
        <div className="text-sm">
          {wrong === "done" ? (
            <span className="text-muted-foreground" data-testid="ask-wrong-done">
              {t("wrongDone")}
            </span>
          ) : (
            <button
              type="button"
              onClick={markWrong}
              disabled={wrong === "saving"}
              className="min-h-11 font-bold text-primary underline-offset-2 hover:underline"
              data-testid="ask-wrong"
            >
              {t("wrong")}
            </button>
          )}
        </div>
      )}

      <FieldError>{error}</FieldError>
    </Card>
  );
}

function AnswerTable({ table }: { table: AskTable }) {
  const head = "px-3 py-2 text-[13px] font-bold text-muted-foreground";
  return (
    <section className="flex flex-col gap-1.5" data-testid="ask-table">
      <h3 className="font-bold">
        {table.title}
        {table.note && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">{table.note}</span>
        )}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-[15px]">
          <thead className="border-b border-border">
            <tr>
              {table.columns.map((column) => (
                <th
                  key={column.label}
                  className={cn(head, column.numeric ? "text-right" : "text-left")}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="border-b border-border last:border-0">
                {row.cells.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "px-3 py-2 align-top",
                      table.columns[c]?.numeric ? "text-right tabular-nums" : "text-left",
                      c === 0 && "font-bold whitespace-nowrap",
                    )}
                  >
                    {c === 0 && row.href ? (
                      <Link href={row.href} className="text-primary">
                        {cell}
                      </Link>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
