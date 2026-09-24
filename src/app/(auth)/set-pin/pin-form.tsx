"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import { setPin } from "@/lib/actions/auth";
import { setPinInput } from "@/lib/validation/auth";

type PinFormProps = {
  // False on a first login or after a manager's reset: there is no old PIN worth asking
  // for, because it is the one being replaced.
  askCurrentPin: boolean;
  nextHref: string;
};

export function PinForm({ askCurrentPin, nextHref }: PinFormProps) {
  const t = useTranslations("auth");
  const tError = useErrorMessage();
  const router = useRouter();

  const { onSubmit, pending, errors, formError } = useActionForm(setPin, setPinInput, () => {
    toast(t("pinSaved"));
    router.replace(nextHref);
  });

  const errorFor = (field: string) => (errors[field] ? tError(errors[field]) : undefined);

  const pinProps = {
    type: "password" as const,
    inputMode: "numeric" as const,
    maxLength: 4,
    autoComplete: "new-password",
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {askCurrentPin && (
        <TextInput
          name="currentPin"
          label={t("fields.currentPin")}
          {...pinProps}
          autoComplete="current-password"
          error={errorFor("currentPin")}
        />
      )}
      <TextInput
        name="pin"
        label={t("fields.newPin")}
        hint={t("hints.pin")}
        {...pinProps}
        error={errorFor("pin")}
      />
      <TextInput
        name="confirmPin"
        label={t("fields.confirmPin")}
        {...pinProps}
        error={errorFor("confirmPin")}
      />

      <FieldError>{formError ? tError(formError) : undefined}</FieldError>

      <Button type="submit" disabled={pending}>
        {t("savePin")}
      </Button>
    </form>
  );
}
