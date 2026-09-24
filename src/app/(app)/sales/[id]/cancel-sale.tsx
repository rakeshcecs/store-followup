"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import { TextArea } from "@/components/ui/text-area";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { cancelSale } from "@/lib/actions/sale";

// M10.09: cancelling needs a reason, and asks once more before it happens. The sale is
// kept as cancelled, never deleted (BR-14).
export function CancelSale({ saleId }: { saleId: string }) {
  const t = useTranslations("sales");
  const tError = useErrorMessage();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function askFirst() {
    if (!reason.trim()) {
      setError("sales.errors.reasonRequired");
      return;
    }
    setError(null);
    setOpen(true);
  }

  function confirm() {
    startTransition(async () => {
      const result = await cancelSale({ id: saleId, reason });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast(t("detail.cancelledToast"));
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading-style text-lg">{t("detail.cancel")}</h2>
      <TextArea
        label={t("detail.cancelReason")}
        maxLength={255}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <FieldError>{error ? tError(error) : undefined}</FieldError>
      <Button type="button" variant="secondary" onClick={askFirst} disabled={pending}>
        {t("detail.cancel")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("detail.cancelTitle")}
        description={t("detail.cancelText")}
        confirmLabel={t("detail.cancelConfirm")}
        cancelLabel={t("detail.keep")}
        danger
        onConfirm={confirm}
      />
    </section>
  );
}
