"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { markUnknownHandled } from "@/lib/actions/whatsapp";

export function HandledButton({ id }: { id: string }) {
  const t = useTranslations("whatsapp.unknown");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markUnknownHandled({ id });
          toast(result.ok ? t("handledToast") : tError(result.message));
          router.refresh();
        })
      }
    >
      {t("handled")}
    </Button>
  );
}
