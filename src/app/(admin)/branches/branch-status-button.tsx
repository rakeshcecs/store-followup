"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { setBranchStatus } from "@/app/(admin)/branches/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import type { RecordStatus } from "@/generated/prisma/client";

type BranchStatusButtonProps = {
  id: string;
  status: RecordStatus;
  staffCount: number;
};

export function BranchStatusButton({ id, status, staffCount }: BranchStatusButtonProps) {
  const t = useTranslations("branches");
  const tError = useErrorMessage(); // action errors arrive as full message keys
  const [pending, startTransition] = useTransition();

  const deactivating = status === "ACTIVE";
  // The server checks this again; here it only saves a pointless round trip.
  const blocked = deactivating && staffCount > 0;

  function confirm() {
    startTransition(async () => {
      const result = await setBranchStatus({ id, status: deactivating ? "INACTIVE" : "ACTIVE" });
      if (result.ok) toast(deactivating ? t("deactivated") : t("activated"));
      else toast.error(tError(result.message));
    });
  }

  if (blocked) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button variant="secondary" size="sm" disabled>
          {t("deactivate")}
        </Button>
        <p className="text-sm text-muted-foreground">
          {t("confirmDeactivate.blocked", { count: staffCount })}
        </p>
      </div>
    );
  }

  const prefix = deactivating ? "confirmDeactivate" : "confirmActivate";

  return (
    <ConfirmDialog
      trigger={
        <Button variant="secondary" size="sm" disabled={pending}>
          {deactivating ? t("deactivate") : t("activate")}
        </Button>
      }
      title={t(`${prefix}.title`)}
      description={t(`${prefix}.text`)}
      confirmLabel={t(`${prefix}.confirm`)}
      cancelLabel={t(`${prefix}.cancel`)}
      danger={deactivating}
      onConfirm={confirm}
    />
  );
}
