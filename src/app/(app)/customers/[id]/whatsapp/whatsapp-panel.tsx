"use client";

import { MessageCircleOff, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { OptionList } from "@/components/ui/option-list";
import { TextArea } from "@/components/ui/text-area";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import {
  recordWhatsAppConsent,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from "@/lib/actions/whatsapp";
import type { MessageValues } from "@/lib/errors";

const TEXT_MAX = 1000;

type TemplateOption = {
  id: string;
  name: string;
  language: string;
  preview: string | null; // null: this one cannot be sent to this customer
  problem: "notSetUp" | "cannotUse" | null;
};

type WhatsAppPanelProps = {
  customer: { id: string; name: string };
  consent: boolean;
  templates: TemplateOption[];
  replyUntil: string | null; // formatted end of the 24-hour window, or null when closed
};

export function WhatsAppPanel({ customer, consent, templates, replyUntil }: WhatsAppPanelProps) {
  const t = useTranslations("whatsapp");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [templateId, setTemplateId] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<{ key: string; values?: MessageValues; where: string } | null>(
    null,
  );

  // BR-19: nothing can be sent until the customer's agreement is recorded.
  if (!consent) {
    return (
      <Card>
        <EmptyState
          icon={MessageCircleOff}
          title={t("noConsent.title")}
          text={t("noConsent.text")}
          action={
            <ConfirmDialog
              trigger={<Button>{t("recordConsent")}</Button>}
              title={t("consentConfirmTitle")}
              description={t("consentConfirmText", { name: customer.name })}
              confirmLabel={t("consentConfirm")}
              cancelLabel={t("cancel")}
              onConfirm={() =>
                startTransition(async () => {
                  const result = await recordWhatsAppConsent({
                    customerId: customer.id,
                    confirmed: true,
                  });
                  if (!result.ok) {
                    toast(tError(result.message, result.values));
                    return;
                  }
                  toast(t("consentSaved"));
                  router.refresh();
                })
              }
            />
          }
        />
      </Card>
    );
  }

  const usable = templates.filter((template) => template.preview !== null);
  const unusable = templates.filter((template) => template.preview === null);

  function sendTemplate() {
    setError(null);
    if (!templateId) {
      setError({ key: "whatsapp.errors.pickTemplate", where: "template" });
      return;
    }
    startTransition(async () => {
      const result = await sendWhatsAppTemplate({ customerId: customer.id, templateId });
      if (!result.ok) {
        setError({ key: result.message, values: result.values, where: "template" });
        return;
      }
      toast(t("sent"));
      setTemplateId("");
      router.refresh();
    });
  }

  function sendReply() {
    setError(null);
    startTransition(async () => {
      const result = await sendWhatsAppText({ customerId: customer.id, text });
      if (!result.ok) {
        setError({ key: result.message, values: result.values, where: "text" });
        return;
      }
      toast(t("sent"));
      setText("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <h3 className="font-heading-style text-lg">{t("templates")}</h3>
        {usable.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("templatesEmpty")}</p>
        ) : (
          <OptionList
            label={t("templates")}
            value={templateId}
            onValueChange={setTemplateId}
            options={usable.map((template) => ({
              value: template.id,
              label: `${template.name} · ${template.language.toUpperCase()}`,
              description: template.preview ?? "",
            }))}
          />
        )}
        {unusable.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {unusable.map((template) => (
              <li key={template.id} data-testid="template-unusable">
                <span className="font-bold">
                  {template.name} · {template.language.toUpperCase()}
                </span>
                {" — "}
                {template.problem ? t(template.problem) : null}
              </li>
            ))}
          </ul>
        )}
        <FieldError>
          {error?.where === "template" ? tError(error.key, error.values) : undefined}
        </FieldError>
        {usable.length > 0 && (
          <Button type="button" onClick={sendTemplate} disabled={pending || !templateId}>
            <Send aria-hidden />
            {t("sendTemplate")}
          </Button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-heading-style text-lg">{t("reply")}</h3>
        {replyUntil ? (
          <>
            <p className="text-sm text-muted-foreground">{t("windowLeft", { time: replyUntil })}</p>
            <TextArea
              label={t("reply")}
              placeholder={t("replyPlaceholder")}
              maxLength={TEXT_MAX}
              value={text}
              onChange={(event) => setText(event.target.value)}
              error={error?.where === "text" ? tError(error.key, error.values) : undefined}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={sendReply}
              disabled={pending || !text.trim()}
            >
              {t("sendReply")}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="window-closed">
            {t("windowClosed")}
          </p>
        )}
      </section>
    </div>
  );
}
