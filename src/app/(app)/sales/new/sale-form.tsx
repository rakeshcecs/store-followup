"use client";

import { AlertCircle, CheckCircle2, ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { checkBill, recordSale } from "@/lib/actions/sale";
import { recordVisit } from "@/lib/actions/visit";
import type { MessageValues } from "@/lib/errors";
import {
  clearVisitDraft,
  parseVisitDraft,
  readVisitDraftRaw,
  type VisitDraft,
} from "@/lib/visit-draft";

const REMARKS_MAX = 250;
const CHECK_DELAY_MS = 300; // M10: "debounced 300 ms"

type SaleFormProps = {
  userId: string;
  customer: { id: string; name: string };
  draftId: string | null; // ?draft= from Record visit
  openEnquiryTitle: string | null;
  amountRequired: boolean; // store setting (SOW Open point #1)
  today: string; // "2026-09-24", IST
};

type Check = { free: true } | { free: false; name: string; date: string };

const noSubscribe = () => () => {};

// M10. With a visit draft the visit and the sale are saved in one call (BR-03); without
// one the sale is added to the open enquiry. With neither, the purchase is a visit that
// has not been recorded yet, and the screen sends the person there.
export function SaleForm(props: SaleFormProps) {
  const raw = useSyncExternalStore(
    noSubscribe,
    () => readVisitDraftRaw(props.userId, props.customer.id),
    () => null,
  );
  const draft = parseVisitDraft(raw, props.userId, props.customer.id);
  // Only the draft this screen was sent with; an older one for the same customer is not
  // a visit the person meant to save now.
  const visit =
    draft && draft.clientId === props.draftId && draft.outcome === "PURCHASED" ? draft : null;
  return <SaleFields key={visit?.clientId ?? "sale"} {...props} visit={visit} />;
}

function SaleFields({
  userId,
  customer,
  openEnquiryTitle,
  amountRequired,
  today,
  visit,
}: SaleFormProps & { visit: VisitDraft | null }) {
  const t = useTranslations("sales");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [saleClientId] = useState(() => crypto.randomUUID());
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [checked, setChecked] = useState<{ bill: string; result: Check } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorValues, setErrorValues] = useState<MessageValues | undefined>(undefined);

  const bill = billNumber.trim().toUpperCase();

  // M10.02 / M10.03: ask the server while the person types, 300 ms after they stop.
  useEffect(() => {
    if (!bill) return;
    const timer = setTimeout(async () => {
      const result = await checkBill({ billNumber: bill });
      if (result.ok) setChecked({ bill, result: result.data });
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [bill]);

  const check = checked?.bill === bill ? checked.result : null;
  const taken = check && !check.free ? check : null;

  // No draft and no open enquiry: nothing to add the sale to (BR-03).
  if (!visit && !openEnquiryTitle) {
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

  function submit() {
    const found: Record<string, string> = {};
    if (amountRequired && !amount) found["billAmount"] = "visits.errors.billAmountRequired";
    if (billDate > today) found["billDate"] = "visits.errors.billDateFuture";
    setErrors(found);
    setErrorValues(undefined);
    if (Object.keys(found).length > 0) return;

    const sale = {
      billNumber: bill,
      billDate,
      billAmount: amount || undefined,
      remarks: remarks.trim() || undefined,
    };

    startTransition(async () => {
      const result = visit
        ? await recordVisit({
            clientId: visit.clientId,
            customerId: customer.id,
            categoryIds: visit.categoryIds,
            expectedPurchase: visit.expectedPurchase,
            remarks: visit.remarks,
            outcome: "PURCHASED",
            sale: { ...sale, clientId: saleClientId },
          })
        : await recordSale({ clientId: saleClientId, customerId: customer.id, sale });

      if (!result.ok) {
        // "sale.billNumber" from the visit action, "billNumber" from the zod parse.
        const field = result.field?.replace(/^sale\./, "") ?? "form";
        setErrors({ [field]: result.message });
        setErrorValues(result.values);
        return;
      }
      clearVisitDraft(userId, customer.id);
      toast(t("saved", { bill }));
      // "/" sends each role home: Today for a salesperson, Overview otherwise.
      router.push("/");
    });
  }

  const errorFor = (field: string) =>
    errors[field] ? tError(errors[field], errorValues) : undefined;
  const stray = Object.entries(errors).find(
    ([field]) => !["billNumber", "billDate", "billAmount", "remarks"].includes(field),
  )?.[1];

  const buttonLabel = !bill ? t("enterBill") : taken ? t("fixBill") : t("save");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <TextInput
          label={t("billNumber")}
          placeholder={t("billPlaceholder")}
          autoComplete="off"
          maxLength={30}
          value={billNumber}
          onChange={(event) => setBillNumber(event.target.value.toUpperCase())}
          className="font-bold uppercase"
          error={errorFor("billNumber")}
        />
        {taken && (
          <p
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-md bg-danger-light px-3 py-2.5 text-sm text-danger"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
            <span>{tError("visits.errors.billTaken", { name: taken.name, date: taken.date })}</span>
          </p>
        )}
        {check?.free && (
          <p className="mt-2 flex items-center gap-2 text-sm font-bold text-success">
            <CheckCircle2 aria-hidden className="size-5 shrink-0" />
            {t("billFree")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <TextInput
          label={t("billDate")}
          type="date"
          max={today}
          value={billDate}
          onChange={(event) => setBillDate(event.target.value)}
          error={errorFor("billDate")}
        />
        <TextInput
          label={amountRequired ? t("amount") : t("amountOptional")}
          inputMode="numeric"
          placeholder="₹"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/\D/g, "").slice(0, 10))}
          error={errorFor("billAmount")}
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

      {openEnquiryTitle && (
        <p className="rounded-xl border border-border bg-muted px-3.5 py-3 text-sm leading-relaxed">
          {t.rich("closesEnquiry", {
            title: openEnquiryTitle,
            b: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      )}

      <FieldError>{stray ? tError(stray, errorValues) : undefined}</FieldError>

      <Button type="button" onClick={submit} disabled={!bill || !!taken || pending}>
        {buttonLabel}
      </Button>
    </div>
  );
}
