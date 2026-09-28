"use client";

import { Bell, CalendarDays, ClipboardList, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useSyncExternalStore, useTransition } from "react";
import { AiFillPanel } from "@/components/ai/ai-fill-panel";
import { aiBox, markOf, unmark, type AiMarks } from "@/components/ai/ai-tag";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import type { Locale } from "@/i18n/config";
import { recordAiOutcome } from "@/lib/actions/ai";
import type { AiSuggestion } from "@/lib/ai/check";
import { saveFollowUp, saveVisit } from "@/lib/offline/actions";
import {
  dayForDisplay,
  FOLLOW_UP_SHORTCUTS,
  followUpShortcut,
  type FollowUpShortcut,
} from "@/lib/follow-up-dates";
import { formatDayDate } from "@/lib/format";
import {
  clearVisitDraft,
  parseVisitDraft,
  readVisitDraftRaw,
  type VisitDraft,
} from "@/lib/visit-draft";

const REASON_MAX = 250;
const SLOTS = ["MORNING", "AFTERNOON", "EVENING"] as const;
const METHODS = ["CALL", "WHATSAPP", "VISIT"] as const;
type Slot = (typeof SLOTS)[number];
type Method = (typeof METHODS)[number];
type When = FollowUpShortcut | "PICK";

type FollowUpFormProps = {
  userId: string;
  customer: { id: string; name: string };
  draftId: string | null; // ?draft= from Record visit
  hasOpenEnquiry: boolean;
  replaces: string | null; // "Sat, 26 Sep" of the pending follow-up this one replaces
  today: string; // "2026-09-24", IST
  aiEnabled?: boolean; // M20
};

const noSubscribe = () => () => {};

// A suggested day is shown on the chip that means it, or under "Pick a date".
function whenFor(date: string, today: string): When {
  return FOLLOW_UP_SHORTCUTS.find((kind) => followUpShortcut(kind, today) === date) ?? "PICK";
}

// M08. With a visit draft the visit and the follow-up are saved in one call (BR-04);
// without one the follow-up is added to the open enquiry (M08.07). With neither there is
// no enquiry to follow up, and the screen sends the person to record the visit.
export function FollowUpForm(props: FollowUpFormProps) {
  const raw = useSyncExternalStore(
    noSubscribe,
    () => readVisitDraftRaw(props.userId, props.customer.id),
    () => null,
  );
  const draft = parseVisitDraft(raw, props.userId, props.customer.id);
  // Only the draft this screen was sent with.
  const visit =
    draft && draft.clientId === props.draftId && draft.outcome === "DECIDE_LATER" ? draft : null;
  return <FollowUpFields key={visit?.clientId ?? "follow-up"} {...props} visit={visit} />;
}

function FollowUpFields({
  userId,
  customer,
  hasOpenEnquiry,
  replaces,
  today,
  aiEnabled,
  visit,
}: FollowUpFormProps & { visit: VisitDraft | null }) {
  const t = useTranslations("followUps");
  const tSync = useTranslations("sync");
  const tError = useErrorMessage();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // M20: the follow-up the AI suggested on Record visit arrives in the draft and starts
  // the form off, marked, so the person sees what came from the note.
  const fromAi = visit?.ai?.followUp;
  const startWhen: When = fromAi?.date ? whenFor(fromAi.date, today) : "SATURDAY";

  const [clientId] = useState(() => crypto.randomUUID());
  // Defaults from the prototype: This Saturday, evening, phone call (decisions.md).
  const [when, setWhen] = useState<When>(startWhen);
  const [picked, setPicked] = useState(fromAi?.date && startWhen === "PICK" ? fromAi.date : "");
  const [slot, setSlot] = useState<Slot>((fromAi?.timeSlot as Slot | undefined) ?? "EVENING");
  const [method, setMethod] = useState<Method>((fromAi?.method as Method | undefined) ?? "CALL");
  // M08.04: the visit's remarks are copied in. They may be up to 500 characters and the
  // reason only 250; the full remarks stay on the visit.
  const [reason, setReason] = useState(() =>
    (fromAi?.reason ?? visit?.remarks ?? "").slice(0, REASON_MAX),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ai, setAi] = useState<AiMarks | null>(() =>
    visit?.ai
      ? {
          suggestionId: visit.ai.suggestionId,
          fields: new Set(
            fromAi
              ? [
                  ...(fromAi.date ? ["dueDate"] : []),
                  "slot",
                  "method",
                  ...(fromAi.reason ? ["reason"] : []),
                ]
              : [],
          ),
          check: new Set(visit.ai.checkFollowUp ? ["dueDate", "slot", "method"] : []),
        }
      : null,
  );
  const touch = (field: string) => setAi((marks) => unmark(marks, field));

  function applySuggestion(s: AiSuggestion, suggestionId: string) {
    const fields = new Set<string>();
    if (s.followUp) {
      if (s.followUp.date) {
        const kind = whenFor(s.followUp.date, today);
        setWhen(kind);
        setPicked(kind === "PICK" ? s.followUp.date : "");
        fields.add("dueDate");
      }
      setSlot(s.followUp.timeSlot);
      setMethod(s.followUp.method);
      fields.add("slot");
      fields.add("method");
      if (s.followUp.reason) {
        setReason(s.followUp.reason.slice(0, REASON_MAX));
        fields.add("reason");
      }
    }
    const check = new Set(s.check.includes("followUp") ? ["dueDate", "slot", "method"] : []);
    setAi({ suggestionId, fields, check });
    setErrors({});
  }

  if (!visit && !hasOpenEnquiry) {
    return (
      <Card>
        <EmptyState
          icon={ClipboardList}
          title={t("visitFirst")}
          text={t("visitFirstText", { name: customer.name })}
          action={
            <Button asChild>
              <Link href={`/visits/new?customerId=${customer.id}`}>{t("recordVisit")}</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const dueDate = when === "PICK" ? picked : followUpShortcut(when, today);
  const dateWords = dueDate ? formatDayDate(dayForDisplay(dueDate), locale) : null;

  function submit() {
    const found: Record<string, string> = {};
    if (!dueDate) found["dueDate"] = "followUps.errors.pickDate";
    else if (dueDate < today) found["dueDate"] = "visits.errors.dueDatePast";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const followUp = { dueDate, timeSlot: slot, method, reason: reason.trim() || undefined };

    startTransition(async () => {
      const result = visit
        ? await saveVisit({
            clientId: visit.clientId,
            customerId: customer.id,
            categoryIds: visit.categoryIds,
            expectedPurchase: visit.expectedPurchase,
            intent: visit.intent,
            remarks: visit.remarks,
            outcome: "DECIDE_LATER",
            followUp: { ...followUp, clientId },
          })
        : await saveFollowUp({ clientId, customerId: customer.id, followUp });

      if (!result.ok) {
        // "followUp.dueDate" from the actions, "dueDate" from a nested zod parse.
        const field = result.field?.replace(/^followUp\./, "") ?? "form";
        setErrors({ [field]: result.message });
        return;
      }
      // M20.07: what was finally saved, against what the AI suggested.
      if (ai) {
        const saved = { date: dueDate, timeSlot: slot, method, reason: followUp.reason };
        void recordAiOutcome({
          suggestionId: ai.suggestionId,
          finalValues: visit
            ? {
                categoryIds: visit.categoryIds,
                expectedPurchase: visit.expectedPurchase,
                intent: visit.intent,
                remarks: visit.remarks,
                outcome: "DECIDE_LATER",
                followUp: saved,
              }
            : { followUp: saved },
        });
      }
      clearVisitDraft(userId, customer.id);
      toast(
        result.data.queued ? tSync("savedOnPhone") : t("saved", { date: dateWords ?? dueDate }),
      );
      // "/" sends each role home: Today for a salesperson, Overview otherwise.
      router.push("/");
    });
  }

  const errorFor = (field: string) => (errors[field] ? tError(errors[field]) : undefined);
  const stray = Object.entries(errors).find(
    ([field]) => !["dueDate", "reason"].includes(field),
  )?.[1];
  const mark = (field: string) => markOf(ai, field);

  return (
    <div className="flex flex-col gap-5.5">
      <AiFillPanel
        screen="followUp"
        customerId={customer.id}
        enabled={aiEnabled ?? false}
        onApply={applySuggestion}
      />

      <div className={aiBox(mark("dueDate").marked)}>
        <span className="mb-2 block text-sm font-bold text-ink-2">
          {t("when")}
          {mark("dueDate").tag}
        </span>
        <ChoiceChips
          type="single"
          label={t("when")}
          value={when}
          onValueChange={(value) => {
            setWhen(value as When);
            touch("dueDate");
          }}
          options={[...FOLLOW_UP_SHORTCUTS, "PICK" as const].map((value) => ({
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
            onChange={(event) => {
              setPicked(event.target.value);
              touch("dueDate");
            }}
            className="mt-2.5"
          />
        )}
        {dateWords && (
          <p className="mt-3 flex items-center gap-2 font-extrabold text-primary-hover">
            <CalendarDays aria-hidden className="size-5 shrink-0" />
            {t("on", { date: dateWords, slot: t(`slotWord.${slot}`) })}
          </p>
        )}
        <FieldError>{errorFor("dueDate")}</FieldError>
      </div>

      <div className={aiBox(mark("slot").marked)}>
        <span className="mb-2 block text-sm font-bold text-ink-2">
          {t("bestTime")}
          {mark("slot").tag}
        </span>
        <ChoiceChips
          type="single"
          label={t("bestTime")}
          value={slot}
          onValueChange={(value) => {
            setSlot(value as Slot);
            touch("slot");
          }}
          options={SLOTS.map((value) => ({ value, label: t(`slot.${value}`) }))}
        />
      </div>

      <div className={aiBox(mark("method").marked)}>
        <span className="mb-2 block text-sm font-bold text-ink-2">
          {t("how")}
          {mark("method").tag}
        </span>
        <ChoiceChips
          type="single"
          label={t("how")}
          value={method}
          onValueChange={(value) => {
            setMethod(value as Method);
            touch("method");
          }}
          options={METHODS.map((value) => ({ value, label: t(`method.${value}`) }))}
        />
      </div>

      <div className={aiBox(mark("reason").marked)}>
        <TextArea
          label={
            <>
              {t("reason")}
              {mark("reason").tag}
            </>
          }
          placeholder={t("reasonPlaceholder")}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            touch("reason");
          }}
          error={errorFor("reason")}
        />
      </div>

      {replaces && (
        <p className="flex items-start gap-2.5 rounded-xl border border-border bg-muted px-3.5 py-3 text-sm leading-relaxed">
          <RefreshCw aria-hidden className="mt-0.5 size-4.5 shrink-0 text-primary" />
          <span>{t("replaces", { date: replaces })}</span>
        </p>
      )}

      <Card className="flex gap-2.5 px-3.5 py-3 text-sm leading-relaxed">
        <Bell aria-hidden className="size-5 shrink-0 text-primary" />
        <span>{t.rich("info", { b: (chunks) => <strong>{chunks}</strong> })}</span>
      </Card>

      <FieldError>{stray ? tError(stray) : undefined}</FieldError>

      <Button type="button" onClick={submit} disabled={pending}>
        {t("save")}
      </Button>
    </div>
  );
}
