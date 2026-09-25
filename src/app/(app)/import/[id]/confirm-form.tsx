"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { cancelImport, startImport } from "@/lib/actions/import";

// M24.03: skip or update the customers who already exist, and "Import [n] customers".
export function ConfirmForm({
  jobId,
  ready,
  existing,
  mistakes,
}: {
  jobId: string;
  ready: number;
  existing: number;
  mistakes: number;
}) {
  const t = useTranslations("import");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updateExisting, setUpdateExisting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const count = ready + (updateExisting ? existing : 0);
  const choices = [
    { value: false, label: t("existingSkip") },
    { value: true, label: t("existingUpdate") },
  ];

  function start() {
    startTransition(async () => {
      const result = await startImport({ jobId, updateExisting });
      if (!result.ok) {
        toast.error(tError(result.message, result.values));
        return;
      }
      router.refresh();
    });
  }

  function discard() {
    startTransition(async () => {
      const result = await cancelImport({ jobId });
      if (!result.ok) {
        toast.error(tError(result.message, result.values));
        return;
      }
      router.push("/import");
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="confirm-form">
      {existing > 0 && (
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className="mb-1 text-[15px] font-bold">
            {t("existingQuestion", { count: existing })}
          </legend>
          {choices.map((choice) => (
            <label
              key={String(choice.value)}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 has-checked:border-primary"
            >
              <input
                type="radio"
                name="existing"
                className="size-5 accent-primary"
                checked={updateExisting === choice.value}
                onChange={() => setUpdateExisting(choice.value)}
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
      )}
      {mistakes > 0 && (
        <p className="text-sm text-muted-foreground">{t("mistakesSkipped", { count: mistakes })}</p>
      )}
      <Button disabled={pending || count === 0} onClick={start}>
        {t("importN", { count })}
      </Button>
      <Button variant="secondary" disabled={pending} onClick={() => setDiscarding(true)}>
        {t("discard")}
      </Button>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t("discardTitle")}
        description={t("discardText")}
        confirmLabel={t("discard")}
        cancelLabel={t("keep")}
        danger
        onConfirm={discard}
      />
    </div>
  );
}
