"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import { updateReminderSettings } from "@/lib/actions/settings";
import { reminderTimesInput, type ReminderTimes } from "@/lib/validation/reminders";

const FIELDS: {
  name: keyof ReminderTimes;
  hint: "morningSummaryHint" | "slotHint" | "managerSummaryHint";
}[] = [
  { name: "morningSummary", hint: "morningSummaryHint" },
  { name: "slotMorning", hint: "slotHint" },
  { name: "slotAfternoon", hint: "slotHint" },
  { name: "slotEvening", hint: "slotHint" },
  { name: "managerSummary", hint: "managerSummaryHint" },
];

export function ReminderForm({ times }: { times: ReminderTimes }) {
  const t = useTranslations("reminderSettings");
  const tError = useErrorMessage();
  const router = useRouter();
  const { onSubmit, pending, errors, formError } = useActionForm(
    updateReminderSettings,
    reminderTimesInput,
    () => {
      toast(t("saved"));
      router.refresh();
    },
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4.5" noValidate>
      <p className="text-[15px] text-muted-foreground">{t("intro")}</p>
      {FIELDS.map((field) => (
        <TextInput
          key={field.name}
          name={field.name}
          type="time"
          label={t(field.name)}
          hint={t(field.hint)}
          defaultValue={times[field.name]}
          error={errors[field.name] ? tError(errors[field.name]!) : undefined}
          required
        />
      ))}
      {formError && <FieldError>{tError(formError)}</FieldError>}
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
