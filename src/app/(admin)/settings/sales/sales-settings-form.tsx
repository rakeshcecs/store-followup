"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { updateSalesSettings } from "@/lib/actions/settings";

export function SalesSettingsForm({ billAmountRequired }: { billAmountRequired: boolean }) {
  const t = useTranslations("salesSettings");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    startTransition(async () => {
      const result = await updateSalesSettings({
        billAmountRequired: formData.get("billAmountRequired") === "on",
      });
      if (!result.ok) {
        toast(tErrors("internal"));
        return;
      }
      toast(t("saved"));
      router.refresh();
    });
  }

  return (
    <form action={save} className="flex flex-col gap-4">
      <Card className="p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="billAmountRequired"
            defaultChecked={billAmountRequired}
            className="mt-0.5 size-5.5 shrink-0 accent-primary"
          />
          <span>
            <span className="block font-bold">{t("billAmountRequired")}</span>
            <span className="block text-sm text-muted-foreground">
              {t("billAmountRequiredHint")}
            </span>
          </span>
        </label>
      </Card>
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
