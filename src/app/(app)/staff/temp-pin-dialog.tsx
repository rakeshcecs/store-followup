"use client";

import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type TempPinDialogProps = {
  name: string;
  pin: string;
  onClose: () => void;
};

// The one moment this PIN is readable. It is never stored in readable form, never logged
// and never audited, so once this closes nobody can look it up — the admin has to write
// it down or say it out loud, and the person changes it at their first login.
export function TempPinDialog({ name, pin, onClose }: TempPinDialogProps) {
  const t = useTranslations("staff");

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("tempPin.title")}
      description={t("tempPin.text", { name })}
      confirmLabel={t("tempPin.done")}
      // No cancel: there is nothing to undo, and closing is the only way out.
      cancelLabel={t("tempPin.done")}
      onConfirm={onClose}
    >
      <p
        // Spaced out and large: this gets read aloud across a counter.
        className="rounded-xl bg-primary-light py-4 text-center font-heading-style text-4xl tracking-[0.35em] text-primary"
      >
        {pin}
      </p>
    </ConfirmDialog>
  );
}
