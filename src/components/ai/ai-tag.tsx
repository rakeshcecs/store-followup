"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// M20.04: a field the AI filled is marked, and a field it was unsure about says so, until
// the person touches it. The forms keep the set of marked fields; this only draws.

// Light indigo behind the whole field block.
export const aiHighlightClass = "-mx-2 rounded-xl bg-primary-light/60 px-2 py-2";

export function aiBox(marked: boolean, className?: string): string {
  return cn(marked && aiHighlightClass, className);
}

export function AiTag({ check }: { check?: boolean }) {
  const t = useTranslations("ai");
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
      <span className="inline-flex items-center gap-0.5 rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-primary-foreground">
        <Sparkles aria-hidden className="size-3" />
        AI
      </span>
      {check && <span className="text-xs font-bold text-warning">{t("check")}</span>}
    </span>
  );
}

// The set of fields the AI filled on a screen, and which of them it was unsure about.
export type AiMarks = {
  suggestionId: string;
  fields: Set<string>;
  check: Set<string>;
};

export function markOf(marks: AiMarks | null, field: string) {
  const marked = marks?.fields.has(field) ?? false;
  return { marked, tag: marked ? <AiTag check={marks?.check.has(field)} /> : null };
}

// The person changed a field: the mark comes off that one field only.
export function unmark(marks: AiMarks | null, field: string): AiMarks | null {
  if (!marks || !marks.fields.has(field)) return marks;
  const fields = new Set(marks.fields);
  fields.delete(field);
  return { ...marks, fields };
}
