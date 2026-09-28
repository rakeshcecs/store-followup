"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { updateAiSettings } from "@/lib/actions/settings";
import { AI_DAILY_LIMIT_MAX } from "@/lib/validation/ai";

type AiSettingsFormProps = {
  enabled: boolean;
  dailyLimit: number;
  configured: boolean; // OPENAI_API_KEY is set on the server
};

export function AiSettingsForm({ enabled, dailyLimit, configured }: AiSettingsFormProps) {
  const t = useTranslations("aiSettings");
  const tErrors = useTranslations("errors");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [limitError, setLimitError] = useState<string | undefined>();

  function save(formData: FormData) {
    setLimitError(undefined);
    startTransition(async () => {
      const result = await updateAiSettings({
        enabled: formData.get("enabled") === "on",
        dailyLimit: formData.get("dailyLimit"),
      });
      if (!result.ok) {
        if (result.field === "dailyLimit") setLimitError(tError(result.message));
        else toast(tErrors("internal"));
        return;
      }
      toast(t("saved"));
      router.refresh();
    });
  }

  return (
    <form action={save} className="flex flex-col gap-4">
      {!configured && (
        <p className="flex gap-2.5 rounded-xl border border-warning/30 bg-warning-light px-3.5 py-3 text-sm leading-relaxed">
          <AlertTriangle aria-hidden className="size-5 shrink-0 text-warning" />
          <span>{t("noKey")}</span>
        </p>
      )}
      <Card className="p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
            className="mt-0.5 size-5.5 shrink-0 accent-primary"
          />
          <span>
            <span className="block font-bold">{t("enabled")}</span>
            <span className="block text-sm text-muted-foreground">{t("enabledHint")}</span>
          </span>
        </label>
      </Card>
      <Card className="p-4">
        <TextInput
          label={t("dailyLimit")}
          name="dailyLimit"
          type="number"
          inputMode="numeric"
          min={1}
          max={AI_DAILY_LIMIT_MAX}
          step={1}
          defaultValue={dailyLimit}
          hint={t("dailyLimitHint")}
          error={limitError}
        />
      </Card>
      <p className="flex gap-2.5 px-1 text-sm leading-relaxed text-muted-foreground">
        <ShieldCheck aria-hidden className="size-5 shrink-0 text-primary" />
        <span>{t("privacy")}</span>
      </p>
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
