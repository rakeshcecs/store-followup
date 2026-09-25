"use client";

import { Info } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { FieldError } from "@/components/ui/field-error";
import { OptionList } from "@/components/ui/option-list";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import type { Locale } from "@/i18n/config";
import { saveFollowUpResult } from "@/lib/offline/actions";
import {
  CALL_AGAIN_SHORTCUTS,
  dayForDisplay,
  followUpShortcut,
  VISIT_DAY_SHORTCUTS,
  type DateShortcut,
} from "@/lib/follow-up-dates";
import { formatDayDate } from "@/lib/format";
import { writeFollowUpNote } from "@/lib/visit-draft";

const NOTE_MAX = 250;
const RESULTS = [
  "WILL_VISIT",
  "CALL_LATER",
  "NOT_REACHABLE",
  "ALREADY_BOUGHT",
  "NOT_INTERESTED",
] as const;
type Result = (typeof RESULTS)[number];
type When = DateShortcut | "PICK";

type ResultFormProps = {
  userId: string;
  followUp: { id: string; customerId: string };
  reasons: { id: string; name: string }[];
  today: string; // "2026-09-24", IST
};

// M09.03–M09.09. One result is required; what else the screen asks for follows from it.
// "Customer already bought" saves nothing here: the follow-up is completed with the sale
// (M09.07), so the note travels to the Sale screen with the person.
export function ResultForm({ userId, followUp, reasons, today }: ResultFormProps) {
  const t = useTranslations("followUpResult");
  const tSync = useTranslations("sync");
  const tError = useErrorMessage();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [clientId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<Result | "">("");
  const [when, setWhen] = useState<When | "">("");
  const [picked, setPicked] = useState("");
  const [lostReasonId, setLostReasonId] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const needsDate = result === "WILL_VISIT" || result === "CALL_LATER";
  const shortcuts = result === "WILL_VISIT" ? VISIT_DAY_SHORTCUTS : CALL_AGAIN_SHORTCUTS;
  const nextDate = when === "PICK" ? picked : when ? followUpShortcut(when, today) : "";

  function choose(value: Result) {
    setResult(value);
    setWhen(""); // the two date rows offer different chips
    setPicked("");
    setErrors({});
  }

  function submit() {
    if (!result) return;
    const trimmed = note.trim();

    if (result === "ALREADY_BOUGHT") {
      writeFollowUpNote(userId, followUp.id, trimmed);
      router.push(`/sales/new?customerId=${followUp.customerId}&followUpId=${followUp.id}`);
      return;
    }

    const found: Record<string, string> = {};
    if (needsDate && !nextDate) found["nextDate"] = "followUps.errors.pickDate";
    else if (needsDate && nextDate < today) found["nextDate"] = "visits.errors.dueDatePast";
    if (result === "NOT_INTERESTED" && !lostReasonId) {
      found["lostReasonId"] = "visits.errors.reasonRequired";
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const base = { id: followUp.id, clientId, note: trimmed || undefined };
    startTransition(async () => {
      const saved = await saveFollowUpResult(
        result === "WILL_VISIT" || result === "CALL_LATER"
          ? { ...base, result, nextDate }
          : result === "NOT_INTERESTED"
            ? { ...base, result, lostReasonId }
            : { ...base, result },
      );
      if (!saved.ok) {
        // "followUp.dueDate" is assertDueDate's field; here it is the next follow-up's day.
        const field = saved.field === "followUp.dueDate" ? "nextDate" : (saved.field ?? "form");
        setErrors({ [field]: saved.message });
        return;
      }
      toast(saved.data.queued ? tSync("savedOnPhone") : t("saved"));
      // "/" sends each role home: Today for a salesperson, Overview otherwise.
      router.push("/");
    });
  }

  const errorFor = (field: string) => (errors[field] ? tError(errors[field]) : undefined);
  const stray = Object.entries(errors).find(
    ([field]) => !["nextDate", "lostReasonId", "note"].includes(field),
  )?.[1];

  const buttonLabel = !result
    ? t("choose")
    : result === "ALREADY_BOUGHT"
      ? t("nextBill")
      : t("save");

  return (
    <div className="flex flex-col gap-5.5">
      <div>
        <span className="mb-2 block text-sm font-bold text-ink-2">{t("whatHappened")}</span>
        <OptionList
          label={t("whatHappened")}
          value={result}
          onValueChange={(value) => choose(value as Result)}
          options={RESULTS.map((value) => ({
            value,
            label: t(`option.${value}.label`),
            description: t(`option.${value}.hint`),
          }))}
        />
      </div>

      {needsDate && (
        <div>
          <span className="mb-2 block text-sm font-bold text-ink-2">
            {result === "WILL_VISIT" ? t("visitDay") : t("callAgain")}
          </span>
          <ChoiceChips
            type="single"
            label={result === "WILL_VISIT" ? t("visitDay") : t("callAgain")}
            value={when}
            onValueChange={(value) => setWhen(value as When)}
            options={[...shortcuts, "PICK" as const].map((value) => ({
              value,
              label: t(`shortcut.${value}`),
            }))}
          />
          {when === "PICK" && (
            <TextInput
              label={t("dateLabel")}
              type="date"
              min={today}
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
              className="mt-2.5"
            />
          )}
          {nextDate && (
            <p className="mt-3 text-sm font-bold text-primary-hover">
              {t("nextOn", { date: formatDayDate(dayForDisplay(nextDate), locale) })}
            </p>
          )}
          <FieldError>{errorFor("nextDate")}</FieldError>
        </div>
      )}

      {result === "NOT_REACHABLE" && (
        <p className="flex gap-2.5 rounded-xl border border-warning/30 bg-warning-light px-3.5 py-3 text-sm leading-relaxed">
          <Info aria-hidden className="size-5 shrink-0 text-warning" />
          <span>{t.rich("notReachableInfo", { b: (chunks) => <strong>{chunks}</strong> })}</span>
        </p>
      )}

      {result === "NOT_INTERESTED" && (
        <div>
          <span className="mb-2 block text-sm font-bold text-ink-2">{t("whyNot")}</span>
          <ChoiceChips
            type="single"
            label={t("whyNot")}
            value={lostReasonId}
            onValueChange={setLostReasonId}
            options={reasons.map((reason) => ({ value: reason.id, label: reason.name }))}
          />
          <FieldError>{errorFor("lostReasonId")}</FieldError>
        </div>
      )}

      <TextArea
        label={t("note")}
        placeholder={t("notePlaceholder")}
        maxLength={NOTE_MAX}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        error={errorFor("note")}
      />

      <FieldError>{stray ? tError(stray) : undefined}</FieldError>

      <Button type="button" onClick={submit} disabled={!result || pending}>
        {buttonLabel}
      </Button>
    </div>
  );
}
