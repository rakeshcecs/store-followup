"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { cancelCampaign } from "@/lib/actions/campaign";

// M23: "Cancel a scheduled campaign before it starts", behind a confirmation.
export function CancelButton({ id }: { id: string }) {
  const t = useTranslations("campaigns");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="secondary" disabled={pending} data-testid="cancel-campaign">
          {t("cancel")}
        </Button>
      }
      title={t("cancelTitle")}
      description={t("cancelText")}
      confirmLabel={t("cancelConfirm")}
      cancelLabel={t("keep")}
      danger
      onConfirm={() =>
        startTransition(async () => {
          const result = await cancelCampaign({ id });
          if (!result.ok) {
            toast.error(tError(result.message, result.values));
            return;
          }
          toast(t("cancelled"));
          router.refresh();
        })
      }
    />
  );
}
