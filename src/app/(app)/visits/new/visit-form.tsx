"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { FieldError } from "@/components/ui/field-error";
import { OptionList } from "@/components/ui/option-list";
import { TextArea } from "@/components/ui/text-area";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { saveVisit } from "@/lib/offline/actions";
import {
  clearVisitDraft,
  parseVisitDraft,
  readVisitDraftRaw,
  writeVisitDraft,
  type VisitDraft,
} from "@/lib/visit-draft";

type Outcome = "PURCHASED" | "DECIDE_LATER" | "NOT_INTERESTED";

const EXPECTED = ["THIS_WEEK", "THIS_MONTH", "NEXT_MONTH", "NOT_SURE"] as const;
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
  draft,
}: VisitFormProps & { draft: VisitDraft | null }) {
  const t = useTranslations("visits");
  const tSync = useTranslations("sync");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Made once per visit and kept in the draft, so the sale or follow-up screen sends the
  // same id and a retry cannot record the visit twice.
  const [clientId] = useState(() => draft?.clientId ?? crypto.randomUUID());
  const [categoryIds, setCategoryIds] = useState<string[]>(draft?.categoryIds ?? []);
  const [expectedPurchase, setExpectedPurchase] = useState(draft?.expectedPurchase ?? "");
  const [remarks, setRemarks] = useState(draft?.remarks ?? "");
  const [outcome, setOutcome] = useState<Outcome | "">(draft?.outcome ?? "");
  const [lostReasonId, setLostReasonId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

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
      remarks: remarks.trim() || undefined,
    };

    if (outcome !== "NOT_INTERESTED") {
      writeVisitDraft({ ...visit, userId, outcome });
      router.push(`${NEXT_PATH[outcome]}?customerId=${customerId}&draft=${clientId}`);
      return;
    }

    startTransition(async () => {
      const result = await saveVisit({ ...visit, outcome, lostReasonId });
      if (!result.ok) {
        setErrors({ [result.field ?? "form"]: result.message });
        return;
      }
      clearVisitDraft(userId, customerId);
      toast(result.data.queued ? tSync("savedOnPhone") : t("saved"));
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

  return (
    <div className="flex flex-col gap-5.5">
      <div>
        <span className="mb-2 block text-sm font-bold text-ink-2">{t("lookingFor")}</span>
        <ChoiceChips
          type="multiple"
          label={t("lookingFor")}
          value={categoryIds}
          onValueChange={setCategoryIds}
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
        />
        <FieldError>{errorFor("categoryIds")}</FieldError>
      </div>

      <div>
        <span className="mb-2 block text-sm font-bold text-ink-2">{t("expectBuy")}</span>
        <ChoiceChips
          type="single"
          label={t("expectBuy")}
          value={expectedPurchase}
          onValueChange={setExpectedPurchase}
          options={EXPECTED.map((value) => ({ value, label: t(`expected.${value}`) }))}
        />
      </div>

      <TextArea
        label={t("remarks")}
        placeholder={t("remarksPlaceholder")}
        maxLength={REMARKS_MAX}
        value={remarks}
        onChange={(event) => setRemarks(event.target.value)}
        error={errorFor("remarks")}
      />

      <div>
        <span className="mb-2 block text-sm font-bold text-ink-2">{t("boughtToday")}</span>
        <OptionList
          label={t("boughtToday")}
          value={outcome}
          onValueChange={(value) => setOutcome(value as Outcome)}
          options={OUTCOMES.map((value) => ({
            value,
            label: t(`outcome.${value}.label`),
            description: t(`outcome.${value}.hint`),
          }))}
        />
      </div>

      {outcome === "NOT_INTERESTED" && (
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

      <FieldError>{stray ? tError(stray) : undefined}</FieldError>

      <Button type="button" onClick={submit} disabled={!outcome || pending}>
        {buttonLabel}
      </Button>
    </div>
  );
}
