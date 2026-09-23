"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { setStaffStatus } from "@/app/(app)/staff/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import type { RecordStatus } from "@/generated/prisma/client";

type StaffStatusButtonProps = {
  id: string;
  name: string;
  status: RecordStatus;
  openCustomers: number;
  openFollowUps: number;
  isSelf: boolean;
};

export function StaffStatusButton({
  id,
  name,
  status,
  openCustomers,
  openFollowUps,
  isSelf,
}: StaffStatusButtonProps) {
  const t = useTranslations("staff");
  // The same two sentences the action sends back, reached through their own namespace so
  // they read as the full keys they are (tests/unit/message-keys.test.ts checks those).
  const tBlocked = useTranslations("staff.errors");
  const tError = useErrorMessage();
  const [pending, startTransition] = useTransition();

  const deactivating = status === "ACTIVE";
  // The server checks all of this again before it writes; here it only explains the
  // disabled button instead of making someone click to find out.
  const openWork = openCustomers + openFollowUps;
  const blocked = deactivating && (isSelf || openWork > 0);

  function confirm() {
    startTransition(async () => {
      const result = await setStaffStatus({ id, status: deactivating ? "INACTIVE" : "ACTIVE" });
      if (result.ok) toast(deactivating ? t("deactivated") : t("activated"));
      else toast.error(tError(result.message, result.values));
    });
  }

  if (blocked) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button variant="secondary" size="sm" disabled>
          {t("deactivate")}
        </Button>
        <p className="text-sm text-muted-foreground">
          {isSelf
            ? tBlocked("cannotDeactivateSelf")
            : // M15 turns this into a link to the reassign screen.
              tBlocked("reassignFirst", { customers: openCustomers, followUps: openFollowUps })}
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
      description={t(`${prefix}.text`, { name })}
      confirmLabel={t(`${prefix}.confirm`)}
      cancelLabel={t(`${prefix}.cancel`)}
      danger={deactivating}
      onConfirm={confirm}
    />
  );
}
