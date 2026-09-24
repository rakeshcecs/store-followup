"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Select } from "@/components/ui/select";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import { updateSale } from "@/lib/actions/sale";
import { updateSaleInput } from "@/lib/validation/sale";

type SaleEditFormProps = {
  sale: {
    id: string;
    billNumber: string;
    billDate: string;
    billAmount: string;
    salespersonId: string;
  };
  staff: { id: string; name: string }[];
  amountRequired: boolean;
  today: string;
};

const OWN_FIELDS = new Set(["billNumber", "billDate", "billAmount", "salespersonId", "reason"]);

// M10.09: a manager or admin corrects the bill number, date, amount or who gets the
// credit — always with a reason, which goes into the audit log and the history.
export function SaleEditForm({ sale, staff, amountRequired, today }: SaleEditFormProps) {
  const t = useTranslations("sales");
  const tError = useErrorMessage();
  const router = useRouter();

  const { onSubmit, pending, errors, formError, errorValues } = useActionForm(
    updateSale,
    updateSaleInput,
    () => {
      toast(t("detail.edited"));
      router.refresh();
    },
  );

  // The action reports bill clashes on "sale.billNumber", like the sale screen.
  const errorFor = (field: string) => {
    const key = errors[field] ?? errors[`sale.${field}`];
    return key ? tError(key, errorValues) : undefined;
  };
  const stray = Object.entries(errors).find(
    ([field]) => !OWN_FIELDS.has(field.replace(/^sale\./, "")),
  )?.[1];
  const bottomError = formError ?? stray;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={sale.id} />
      <TextInput
        name="billNumber"
        label={t("billNumber")}
        defaultValue={sale.billNumber}
        maxLength={30}
        autoComplete="off"
        className="font-bold uppercase"
        error={errorFor("billNumber")}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <TextInput
          name="billDate"
          label={t("billDate")}
          type="date"
          max={today}
          defaultValue={sale.billDate}
          error={errorFor("billDate")}
        />
        <TextInput
          name="billAmount"
          label={amountRequired ? t("amount") : t("amountOptional")}
          inputMode="numeric"
          defaultValue={sale.billAmount}
          error={errorFor("billAmount")}
        />
      </div>
      <Select
        name="salespersonId"
        label={t("detail.salesperson")}
        defaultValue={sale.salespersonId}
        options={staff.map((person) => ({ value: person.id, label: person.name }))}
        error={errorFor("salespersonId")}
      />
      <TextArea
        name="reason"
        label={t("detail.reason")}
        maxLength={255}
        error={errorFor("reason")}
      />
      <FieldError>{bottomError ? tError(bottomError, errorValues) : undefined}</FieldError>
      <Button type="submit" disabled={pending}>
        {t("detail.saveEdit")}
      </Button>
    </form>
  );
}
