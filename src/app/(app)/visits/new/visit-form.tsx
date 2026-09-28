"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { AiFillPanel } from "@/components/ai/ai-fill-panel";
import { aiBox, markOf, unmark, type AiMarks } from "@/components/ai/ai-tag";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { FieldError } from "@/components/ui/field-error";
import { OptionList } from "@/components/ui/option-list";
import { TextArea } from "@/components/ui/text-area";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { recordAiOutcome } from "@/lib/actions/ai";
import type { AiFollowUp, AiSuggestion } from "@/lib/ai/check";
import { recordVisit } from "@/lib/actions/visit";
import { reachServer } from "@/lib/reach-server";
import {
  clearVisitDraft,
  parseVisitDraft,
  readVisitDraftRaw,
  writeVisitDraft,
  type VisitDraft,
} from "@/lib/visit-draft";

type Outcome = "PURCHASED" | "DECIDE_LATER" | "NOT_INTERESTED";

const EXPECTED = ["THIS_WEEK", "THIS_MONTH", "NEXT_MONTH", "NOT_SURE"] as const;
const INTENTS = ["HOT", "WARM", "COLD"] as const;
const OUTCOMES: Outcome[] = ["PURCHASED", "DECIDE_LATER", "NOT_INTERESTED"];
const REMARKS_MAX = 500;

// Where "Yes" and "No" go next, carrying the draft (M10 and M08 draw those screens).
const NEXT_PATH: Record<Exclude<Outcome, "NOT_INTERESTED">, string> = {
  PURCHASED: "/sales/new",
  DECIDE_LATER: "/follow-ups/new",
};

type VisitFormProps = {
  userId: string; // whose draft this is — shops share phones
  customerId: string;
  categories: { id: string; name: string }[];
  reasons: { id: string; name: string }[];
  aiEnabled?: boolean; // M20: the admin's switch, with a key on the server
  aiOpen?: boolean; // the profile's "Ask AI to fill" lands here with the panel open
};

const noSubscribe = () => () => {};

// M07. "Not interested" saves here and now; "Yes" and "No" keep the visit as a draft and
// hand it to the sale or follow-up screen, which saves both in one call (BR-03, BR-04).
//
// Coming back from that screen picks the draft up again. sessionStorage does not exist on
// the server, so the server renders an empty form and the browser swaps in the draft —
// the key makes that a fresh form, started from the draft, rather than a state update.
export function VisitForm(props: VisitFormProps) {
  const raw = useSyncExternalStore(
    noSubscribe,
    () => readVisitDraftRaw(props.userId, props.customerId),
    () => null,
  );
  return (
    <VisitFields
      key={raw ?? "new"}
      {...props}
      draft={parseVisitDraft(raw, props.userId, props.customerId)}
    />
  );
}

function VisitFields({
  userId,
  customerId,
  categories,
  reasons,
  aiEnabled,
  aiOpen,
  draft,
}: VisitFormProps & { draft: VisitDraft | null }) {
  const t = useTranslations("visits");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Made once per visit and kept in the draft, so the sale or follow-up screen sends the
  // same id and a retry cannot record the visit twice.
  const [clientId] = useState(() => draft?.clientId ?? crypto.randomUUID());
  const [categoryIds, setCategoryIds] = useState<string[]>(draft?.categoryIds ?? []);
  const [expectedPurchase, setExpectedPurchase] = useState(draft?.expectedPurchase ?? "");
  const [intent, setIntent] = useState(draft?.intent ?? "");
  const [remarks, setRemarks] = useState(draft?.remarks ?? "");
  const [outcome, setOutcome] = useState<Outcome | "">(draft?.outcome ?? "");
  const [lostReasonId, setLostReasonId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // M20: which fields the AI filled (marked until touched), and the follow-up it
  // suggested, which travels in the draft to the Set follow-up screen.
  const [ai, setAi] = useState<AiMarks | null>(null);
  const [aiFollowUp, setAiFollowUp] = useState<AiFollowUp | undefined>(
    draft?.ai?.followUp as AiFollowUp | undefined,
  );
  const touch = (field: string) => setAi((marks) => unmark(marks, field));

  function applySuggestion(s: AiSuggestion, suggestionId: string) {
    const fields = new Set<string>();
    const set = <T,>(field: string, value: T | undefined, setter: (value: T) => void) => {
      if (value === undefined) return;
      setter(value);
      fields.add(field);
    };
    set("categoryIds", s.categoryIds, setCategoryIds);
    set("expectedPurchase", s.expectedPurchase, setExpectedPurchase);
    set("intent", s.intent, setIntent);
    set("remarks", s.remarks, setRemarks);
    set("outcome", s.outcome, setOutcome);
    if (s.outcome === "NOT_INTERESTED" && s.lostReasonId) {
      setLostReasonId(s.lostReasonId);
      fields.add("lostReasonId");
    }
    setAiFollowUp(s.followUp);
    setAi({ suggestionId, fields, check: new Set(s.check) });
    setErrors({});
  }

  function submit() {
    const found: Record<string, string> = {};
    if (categoryIds.length === 0) found["categoryIds"] = "visits.errors.categoryRequired";
    if (outcome === "NOT_INTERESTED" && !lostReasonId) {
      found["lostReasonId"] = "visits.errors.reasonRequired";
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !outcome) return;

    const visit = {
      clientId,
      customerId,
      categoryIds,
      expectedPurchase: expectedPurchase || undefined,
      intent: intent || undefined,
      remarks: remarks.trim() || undefined,
    };
    const finalValues = { ...visit, outcome };

    if (outcome !== "NOT_INTERESTED") {
      const suggestionId = ai?.suggestionId ?? draft?.ai?.suggestionId;
      writeVisitDraft({
        ...visit,
        userId,
        outcome,
        ai: suggestionId
          ? {
              suggestionId,
              followUp: aiFollowUp,
              checkFollowUp: ai?.check.has("followUp") ?? false,
            }
          : undefined,
      });
      // The visit's fields are final at this point (the sale screen has none of them); the
      // follow-up screen reports its own, so "decide later" is logged from there.
      if (outcome === "PURCHASED" && suggestionId)
        void recordAiOutcome({ suggestionId, finalValues });
      router.push(`${NEXT_PATH[outcome]}?customerId=${customerId}&draft=${clientId}`);
      return;
    }

    startTransition(async () => {
      const result = await reachServer(recordVisit({ ...visit, outcome, lostReasonId }));
      if (!result.ok) {
        setErrors({ [result.field ?? "form"]: result.message });
        return;
      }
      if (ai)
        void recordAiOutcome({
          suggestionId: ai.suggestionId,
          finalValues: { ...finalValues, lostReasonId },
        });
      clearVisitDraft(userId, customerId);
      toast(t("saved"));
      // "/" sends each role to its own home: Today for a salesperson, Overview otherwise.
      router.push("/");
    });
  }

  const errorFor = (field: string) => (errors[field] ? tError(errors[field]) : undefined);
  const stray = Object.entries(errors).find(
    ([field]) => !["categoryIds", "remarks", "lostReasonId"].includes(field),
  )?.[1];

  const buttonLabel =
    outcome === "PURCHASED"
      ? t("nextBill")
      : outcome === "DECIDE_LATER"
        ? t("nextFollowUp")
        : outcome === "NOT_INTERESTED"
          ? t("saveAndClose")
          : t("chooseAnswer");

  const mark = (field: string) => markOf(ai, field);

  return (
    <div className="flex flex-col gap-5.5">
      <AiFillPanel
        screen="visit"
        customerId={customerId}
        enabled={aiEnabled ?? false}
        defaultOpen={aiOpen}
        onApply={applySuggestion}
      />

      <div className={aiBox(mark("categoryIds").marked)}>
        <span className="mb-2 block text-sm font-bold text-ink-2">
          {t("lookingFor")}
          {mark("categoryIds").tag}
        </span>
        <ChoiceChips
          type="multiple"
          label={t("lookingFor")}
          value={categoryIds}
          onValueChange={(value) => {
            setCategoryIds(value);
            touch("categoryIds");
          }}
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
        />
        <FieldError>{errorFor("categoryIds")}</FieldError>
      </div>

      <div className={aiBox(mark("expectedPurchase").marked)}>
        <span className="mb-2 block text-sm font-bold text-ink-2">
          {t("expectBuy")}
          {mark("expectedPurchase").tag}
        </span>
        <ChoiceChips
          type="single"
          label={t("expectBuy")}
          value={expectedPurchase}
          onValueChange={(value) => {
            setExpectedPurchase(value);
            touch("expectedPurchase");
          }}
          options={EXPECTED.map((value) => ({ value, label: t(`expected.${value}`) }))}
        />
      </div>

      {/* M20 / SOW 5.5: Hot / Warm / Cold, suggested by the AI, confirmed by staff. */}
      <div className={aiBox(mark("intent").marked)}>
        <span className="mb-2 block text-sm font-bold text-ink-2">
          {t("intent")}
          {mark("intent").tag}
        </span>
        <ChoiceChips
          type="single"
          label={t("intent")}
          value={intent}
          onValueChange={(value) => {
            setIntent(value);
            touch("intent");
          }}
          options={INTENTS.map((value) => ({ value, label: t(`intentOption.${value}`) }))}
        />
      </div>

      <div className={aiBox(mark("remarks").marked)}>
        <TextArea
          label={
            <>
              {t("remarks")}
              {mark("remarks").tag}
            </>
          }
          placeholder={t("remarksPlaceholder")}
          maxLength={REMARKS_MAX}
          value={remarks}
          onChange={(event) => {
            setRemarks(event.target.value);
            touch("remarks");
          }}
          error={errorFor("remarks")}
        />
      </div>

      <div className={aiBox(mark("outcome").marked)}>
        <span className="mb-2 block text-sm font-bold text-ink-2">
          {t("boughtToday")}
          {mark("outcome").tag}
        </span>
        <OptionList
          label={t("boughtToday")}
          value={outcome}
          onValueChange={(value) => {
            setOutcome(value as Outcome);
            touch("outcome");
          }}
          options={OUTCOMES.map((value) => ({
            value,
            label: t(`outcome.${value}.label`),
            description: t(`outcome.${value}.hint`),
          }))}
        />
      </div>

      {outcome === "NOT_INTERESTED" && (
        <div className={aiBox(mark("lostReasonId").marked)}>
          <span className="mb-2 block text-sm font-bold text-ink-2">
            {t("whyNot")}
            {mark("lostReasonId").tag}
          </span>
          <ChoiceChips
            type="single"
            label={t("whyNot")}
            value={lostReasonId}
            onValueChange={(value) => {
              setLostReasonId(value);
              touch("lostReasonId");
            }}
            options={reasons.map((reason) => ({ value: reason.id, label: reason.name }))}
          />
          <FieldError>{errorFor("lostReasonId")}</FieldError>
        </div>
      )}

      <FieldError>{stray ? tError(stray) : undefined}</FieldError>

      <Button type="button" onClick={submit} disabled={!outcome || pending}>
        {buttonLabel}
      </Button>
    </div>
  );
}
