"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

// A screen that failed to render, in the reader's language (M18.01) instead of Next's
// English default. The root layout (and its language provider) is still standing here.
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("errorPage");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col justify-center p-5">
      <Card>
        <EmptyState
          icon={AlertTriangle}
          title={t("title")}
          text={t("text")}
          action={
            <div className="flex flex-col gap-2">
              <Button className="w-full" onClick={() => retry()}>
                {t("retry")}
              </Button>
              <Button asChild variant="secondary" className="w-full">
                <Link href="/" prefetch={false}>
                  {t("home")}
                </Link>
              </Button>
            </div>
          }
        />
      </Card>
    </main>
  );
}
