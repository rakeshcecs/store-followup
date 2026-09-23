"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBranch, updateBranch } from "@/app/(admin)/branches/actions";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useActionForm } from "@/hooks/use-action-form";
import { branchInput, updateBranchInput } from "@/lib/validation/branch";

type BranchFormValues = {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  gstNumber: string | null;
  openingHours: string | null;
};

// One form for adding and editing: the only difference is the hidden id and which
// action and schema it uses.
export function BranchForm({ branch }: { branch?: BranchFormValues }) {
  const t = useTranslations("branches");
  const tError = useErrorMessage(); // field errors arrive as full message keys
  const router = useRouter();

  const { formAction, pending, errors, formError } = useActionForm(
    branch ? updateBranch : createBranch,
    branch ? updateBranchInput : branchInput,
    () => {
      toast(t("saved"));
      router.push("/branches");
    },
  );

  const errorFor = (field: keyof BranchFormValues) =>
    errors[field] ? tError(errors[field]) : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4.5" noValidate>
      {branch && <input type="hidden" name="id" value={branch.id} />}

      <TextInput
        name="name"
        label={t("fields.name")}
        placeholder={t("placeholders.name")}
        defaultValue={branch?.name}
        error={errorFor("name")}
        autoComplete="off"
      />
      <TextInput
        name="address"
        label={t("fields.address")}
        defaultValue={branch?.address}
        error={errorFor("address")}
        autoComplete="off"
      />
      <TextInput
        name="city"
        label={t("fields.city")}
        defaultValue={branch?.city}
        error={errorFor("city")}
        autoComplete="off"
      />
      <TextInput
        name="phone"
        type="tel"
        inputMode="tel"
        label={t("fields.phone")}
        placeholder={t("placeholders.phone")}
        defaultValue={branch?.phone}
        error={errorFor("phone")}
        autoComplete="off"
      />
      <TextInput
        name="gstNumber"
        label={t("fields.gstNumber")}
        hint={t("hints.gstNumber")}
        defaultValue={branch?.gstNumber ?? ""}
        error={errorFor("gstNumber")}
        autoComplete="off"
      />
      <TextInput
        name="openingHours"
        label={t("fields.openingHours")}
        hint={t("hints.openingHours")}
        placeholder={t("placeholders.openingHours")}
        defaultValue={branch?.openingHours ?? ""}
        error={errorFor("openingHours")}
        autoComplete="off"
      />

      <FieldError>{formError ? tError(formError) : undefined}</FieldError>

      <div className="flex flex-col gap-2.5">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <Button asChild variant="secondary">
          <Link href="/branches">{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
