"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card } from "@/components/ui/card";

// The worker's progress, refreshed every two seconds until it is done. Leaving the page
// does not stop anything: the import runs in the worker.
export function ImportProgress({ processed, total }: { processed: number; total: number }) {
  const t = useTranslations("import");
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 2_000);
    return () => clearInterval(timer);
  }, [router]);
  const percent = total === 0 ? 0 : Math.round((processed / total) * 100);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="font-heading-style text-lg">{t("running")}</h2>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t("running")}
        className="h-3 overflow-hidden rounded-full bg-grey-light"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm text-muted-foreground" data-testid="import-progress">
        {t("progress", { processed, total })}
      </p>
      <p className="text-sm text-muted-foreground">{t("canLeave")}</p>
    </Card>
  );
}
