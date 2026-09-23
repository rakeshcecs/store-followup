"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { resetPin } from "@/lib/actions/auth";
import { TempPinDialog } from "@/app/(app)/staff/temp-pin-dialog";

type ResetPinButtonProps = {
  id: string;
  name: string;
};

// A manager's one power on this screen (the login screen tells people to ask them).
export function ResetPinButton({ id, name }: ResetPinButtonProps) {
  const t = useTranslations("staff");
  const tError = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const [newPin, setNewPin] = useState<string | null>(null);

  function confirm() {
    startTransition(async () => {
      const result = await resetPin({ userId: id });
      // The PIN comes back exactly once; nothing stores it, so the dialog holds it until
      // the admin closes it.
      if (result.ok) setNewPin(result.data.pin);
      else toast.error(tError(result.message, result.values));
    });
  }

  return (
    <>
      <ConfirmDialog
        trigger={
          <Button variant="secondary" size="sm" disabled={pending}>
            <KeyRound aria-hidden />
            {t("resetPin")}
          </Button>
        }
        title={t("confirmReset.title")}
        description={t("confirmReset.text", { name })}
        confirmLabel={t("confirmReset.confirm")}
        cancelLabel={t("confirmReset.cancel")}
        onConfirm={confirm}
      />

      {newPin && <TempPinDialog name={name} pin={newPin} onClose={() => setNewPin(null)} />}
    </>
  );
}
