"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { MobileInput } from "@/app/(app)/customers/mobile-input";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { FieldError } from "@/components/ui/field-error";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import { updateCustomer } from "@/lib/actions/customer";
import { updateCustomerInput } from "@/lib/validation/customer";

export type EditableCustomer = {
  id: string;
  name: string;
  mobile: string;
  altMobile: string;
  area: string;
  city: string;
  address: string;
  occasion: string;
  occasionDate: string; // "2026-12-12" or ""
  departmentId: string;
};

type EditCustomerFormProps = {
  customer: EditableCustomer;
  departments: { id: string; name: string }[];
  canChangeMobile: boolean; // manager or admin only (M06)
};

// M06.07. Every box is posted, so emptying one clears it. A salesperson gets no mobile
// box at all, and the action refuses a changed number from them anyway.
export function EditCustomerForm({
  customer,
  departments,
  canChangeMobile,
}: EditCustomerFormProps) {
  const t = useTranslations("customers");
  const tError = useErrorMessage();
  const router = useRouter();
  const [departmentId, setDepartmentId] = useState(customer.departmentId);
  const profilePath = `/customers/${customer.id}`;

  const { formAction, pending, errors, formError, errorValues } = useActionForm(
    updateCustomer,
    updateCustomerInput,
    () => {
      toast(t("edit.saved"));
      router.push(profilePath);
    },
  );

  // The fields this form draws a box for; anything else is shown at the bottom.
  const ownFields = new Set([
    "name",
    ...(canChangeMobile ? ["mobile"] : []),
    "altMobile",
    "area",
    "city",
    "address",
    "occasion",
    "occasionDate",
  ]);
  const errorFor = (field: string) =>
    errors[field] ? tError(errors[field], errorValues) : undefined;
  const strayError = Object.entries(errors).find(([field]) => !ownFields.has(field))?.[1];
  const bottomError = formError ?? strayError;

  return (
    <form action={formAction} className="flex flex-col gap-4.5" noValidate>
      <input type="hidden" name="id" value={customer.id} />

      <TextInput
        name="name"
        label={t("fields.name")}
        autoComplete="off"
        defaultValue={customer.name}
        error={errorFor("name")}
      />

      {canChangeMobile && (
        <MobileInput
          label={t("fields.mobile")}
          defaultValue={customer.mobile}
          error={errorFor("mobile")}
        />
      )}

      <MobileInput
        name="altMobile"
        label={t("fields.altMobile")}
        defaultValue={customer.altMobile}
        error={errorFor("altMobile")}
      />

      <div className="grid gap-4.5 sm:grid-cols-2">
        <TextInput
          name="area"
          label={t("fields.area")}
          defaultValue={customer.area}
          error={errorFor("area")}
        />
        <TextInput
          name="city"
          label={t("fields.city")}
          defaultValue={customer.city}
          error={errorFor("city")}
        />
      </div>
      <TextInput
        name="address"
        label={t("fields.address")}
        defaultValue={customer.address}
        error={errorFor("address")}
      />
      <TextInput
        name="occasion"
        label={t("fields.occasion")}
        defaultValue={customer.occasion}
        error={errorFor("occasion")}
      />
      <TextInput
        name="occasionDate"
        label={t("fields.occasionDate")}
        type="date"
        defaultValue={customer.occasionDate}
        error={errorFor("occasionDate")}
      />

      {departments.length > 0 && (
        <div>
          <span className="mb-2 block text-sm font-bold text-ink-2">{t("fields.department")}</span>
          <ChoiceChips
            type="single"
            label={t("fields.department")}
            value={departmentId}
            onValueChange={setDepartmentId}
            options={departments.map((department) => ({
              value: department.id,
              label: department.name,
            }))}
          />
          <input type="hidden" name="departmentId" value={departmentId} />
        </div>
      )}

      <FieldError>{bottomError ? tError(bottomError, errorValues) : undefined}</FieldError>

      <div className="flex flex-col gap-2.5">
        <Button type="submit" disabled={pending}>
          {t("edit.save")}
        </Button>
        <Button asChild variant="secondary">
          <Link href={profilePath}>{t("edit.cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
