"use client";

import { Bell, CalendarDays, ClipboardList, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useSyncExternalStore, useTransition } from "react";
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
};

const noSubscribe = () => () => {};

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
  visit,
}: FollowUpFormProps & { visit: VisitDraft | null }) {
  const t = useTranslations("followUps");
  const tSync = useTranslations("sync");
  const tError = useErrorMessage();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [clientId] = useState(() => crypto.randomUUID());
  // Defaults from the prototype: This Saturday, evening, phone call (decisions.md).
  const [when, setWhen] = useState<When>("SATURDAY");
  const [picked, setPicked] = useState("");
  const [slot, setSlot] = useState<Slot>("EVENING");
  const [method, setMethod] = useState<Method>("CALL");
  // M08.04: the visit's remarks are copied in. They may be up to 500 characters and the
  // reason only 250; the full remarks stay on the visit.
  const [reason, setReason] = useState(() => (visit?.remarks ?? "").slice(0, REASON_MAX));
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  return (
    <div className="flex flex-col gap-5.5">
      <div>
        <span className="mb-2 block text-sm font-bold text-ink-2">{t("when")}</span>
        <ChoiceChips
          type="single"
          label={t("when")}
          value={when}
          onValueChange={(value) => setWhen(value as When)}
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
            onChange={(event) => setPicked(event.target.value)}
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

      <div>
        <span className="mb-2 block text-sm font-bold text-ink-2">{t("bestTime")}</span>
        <ChoiceChips
          type="single"
          label={t("bestTime")}
          value={slot}
          onValueChange={(value) => setSlot(value as Slot)}
          options={SLOTS.map((value) => ({ value, label: t(`slot.${value}`) }))}
        />
      </div>

      <div>
        <span className="mb-2 block text-sm font-bold text-ink-2">{t("how")}</span>
        <ChoiceChips
          type="single"
          label={t("how")}
          value={method}
          onValueChange={(value) => setMethod(value as Method)}
          options={METHODS.map((value) => ({ value, label: t(`method.${value}`) }))}
        />
      </div>

      <TextArea
        label={t("reason")}
        placeholder={t("reasonPlaceholder")}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={errorFor("reason")}
      />

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
