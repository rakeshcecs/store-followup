"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { deleteCustomerData } from "@/lib/actions/privacy";
import { startNewTrail } from "@/lib/nav-history";

// Type the last four digits, press, confirm once more. The server checks the digits.
export function DeleteDataForm({ customerId, name }: { customerId: string; name: string }) {
  const t = useTranslations("privacy");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastFour, setLastFour] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);

  function submit() {
    startTransition(async () => {
      const result = await deleteCustomerData({ customerId, lastFour });
      if (!result.ok) {
        const message = tError(result.message, result.values);
        if (result.field === "lastFour") setError(message);
        else toast.error(message);
        return;
      }
      toast(t("done"));
      // Everything behind this screen was about a customer who is gone now: nothing to
      // go back to, so Customers starts a new trail (its arrow uses its own backHref).
      startNewTrail();
      router.replace("/customers");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <TextInput
        label={t("lastFour")}
        hint={t("lastFourHint")}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={lastFour}
        error={error}
        disabled={pending}
        onChange={(event) => {
          setLastFour(event.target.value.replace(/\D/g, ""));
          setError(undefined);
        }}
      />
      <Button
        className="bg-danger text-white hover:bg-danger/90"
        disabled={lastFour.length !== 4 || pending}
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden />
        {t("submit")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("confirmTitle")}
        description={t("confirmText", { name })}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        danger
        onConfirm={submit}
      />
    </div>
  );
}
