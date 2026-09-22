import { WifiOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { RetryButton } from "./retry-button";

// Precached by the service worker; shown when a page can't load without internet.
export default async function OfflinePage() {
  const t = await getTranslations("offline");

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col justify-center p-5">
      <Card>
        <EmptyState
          icon={WifiOff}
          title={t("title")}
          text={t("text")}
          action={<RetryButton label={t("retry")} />}
        />
      </Card>
    </main>
  );
}
