"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import { updateOccasionSettings } from "@/lib/actions/festival";
import { occasionSettingsInput, type OccasionSettings } from "@/lib/validation/festival";

// The occasion lead days (default 30).
export function OccasionSettingsForm({ value }: { value: OccasionSettings }) {
  const t = useTranslations("festivals");
  const tError = useErrorMessage();
  const router = useRouter();
  const { onSubmit, pending, errors, formError } = useActionForm(
    updateOccasionSettings,
    occasionSettingsInput,
    () => {
      toast(t("saved"));
      router.refresh();
    },
  );
  return (
    <Card className="p-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextInput
          name="occasionLeadDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={90}
          label={t("leadDays")}
          hint={t("leadDaysHint")}
          defaultValue={value.occasionLeadDays}
          error={errors["occasionLeadDays"] ? tError(errors["occasionLeadDays"]) : undefined}
        />
        {formError && <FieldError>{tError(formError)}</FieldError>}
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </form>
    </Card>
  );
}
