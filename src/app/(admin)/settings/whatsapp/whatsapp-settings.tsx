"use client";

import { RefreshCw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ZodType } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import {
  saveAutomaticWhatsApp,
  saveWhatsAppConnection,
  saveWhatsAppTemplateMapping,
  sendWhatsAppTest,
  syncWhatsAppTemplates,
} from "@/lib/actions/whatsapp";
import type { ActionResult, MessageValues } from "@/lib/errors";
import { connectionInput, testMessageInput } from "@/lib/validation/whatsapp";
import { TEMPLATE_FIELDS } from "@/lib/whatsapp/fields";
import type { AutomaticSettings, ConnectionSummary } from "@/lib/whatsapp/settings";

const AUTOMATIC = ["thankYou", "visitReminder", "occasion"] as const;
const TONE = { APPROVED: "green", PENDING: "amber", REJECTED: "red" } as const;

type Problem = { key: string; values?: MessageValues; field?: string } | null;

// One save → toast, or the problem to show. Shared by every form on this screen.
function useSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<Problem>(null);
  function save<T>(run: () => Promise<ActionResult<T>>, done: (data: T) => void) {
    setProblem(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setProblem({ key: result.message, values: result.values, field: result.field });
        return;
      }
      done(result.data);
      router.refresh();
    });
  }
  // The same schema as the action, first, so the exact message shows (the action only
  // says which field).
  function valid(schema: ZodType, value: unknown): boolean {
    const parsed = schema.safeParse(value);
    if (parsed.success) return true;
    const issue = parsed.error.issues[0];
    setProblem({ key: issue?.message ?? "errors.validation", field: issue?.path.join(".") });
    return false;
  }
  return { pending, problem, save, valid };
}

export function ConnectionForm({ summary }: { summary: ConnectionSummary }) {
  const t = useTranslations("whatsapp.settings");
  const tError = useErrorMessage();
  const { pending, problem, save, valid } = useSave();

  const secretHint = (saved: boolean) => (saved ? t("secretSaved") : t("secretMissing"));
  const errorFor = (field: string) =>
    problem?.field === field ? tError(problem.key, problem.values) : undefined;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const value = (name: string) => String(form.get(name) ?? "");
        const input = {
          phoneNumberId: value("phoneNumberId"),
          wabaId: value("wabaId"),
          accessToken: value("accessToken"),
          appSecret: value("appSecret"),
          verifyToken: value("verifyToken"),
        };
        if (!valid(connectionInput, input)) return;
        save(
          () => saveWhatsAppConnection(input),
          () => toast(t("saved")),
        );
      }}
    >
      <TextInput
        name="phoneNumberId"
        label={t("phoneNumberId")}
        inputMode="numeric"
        autoComplete="off"
        defaultValue={summary.phoneNumberId}
        error={errorFor("phoneNumberId")}
      />
      <TextInput
        name="wabaId"
        label={t("wabaId")}
        inputMode="numeric"
        autoComplete="off"
        defaultValue={summary.wabaId}
        error={errorFor("wabaId")}
      />
      <TextInput
        name="accessToken"
        type="password"
        autoComplete="off"
        label={t("accessToken")}
        hint={secretHint(summary.hasAccessToken)}
      />
      <TextInput
        name="appSecret"
        type="password"
        autoComplete="off"
        label={t("appSecret")}
        hint={secretHint(summary.hasAppSecret)}
      />
      <TextInput
        name="verifyToken"
        type="password"
        autoComplete="off"
        label={t("verifyToken")}
        hint={secretHint(summary.hasVerifyToken)}
      />
      <FieldError>
        {problem && !["phoneNumberId", "wabaId"].includes(problem.field ?? "")
          ? tError(problem.key, problem.values)
          : undefined}
      </FieldError>
      <Button type="submit" disabled={pending}>
        {t("saveConnection")}
      </Button>
    </form>
  );
}

export function TestMessageForm() {
  const t = useTranslations("whatsapp.settings");
  const tError = useErrorMessage();
  const { pending, problem, save, valid } = useSave();
  const [mobile, setMobile] = useState("");
  return (
    <Card className="flex flex-col gap-3 p-3.5">
      <p className="font-bold">{t("test")}</p>
      <p className="text-sm text-muted-foreground">{t("testHint")}</p>
      <TextInput
        label={t("testMobile")}
        inputMode="numeric"
        value={mobile}
        onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))}
        error={problem ? tError(problem.key, problem.values) : undefined}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={pending || mobile.length !== 10}
        onClick={() => {
          if (!valid(testMessageInput, { mobile })) return;
          save(
            () => sendWhatsAppTest({ mobile }),
            () => toast(t("testSent")),
          );
        }}
      >
        <Send aria-hidden />
        {t("testSend")}
      </Button>
    </Card>
  );
}

type TemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  variables: string[];
  mapping: Record<string, string>;
  metaStatus: "APPROVED" | "PENDING" | "REJECTED";
};

export function TemplateList({
  connected,
  templates,
}: {
  connected: boolean;
  templates: TemplateRow[];
}) {
  const t = useTranslations("whatsapp.settings");
  const tError = useErrorMessage();
  const { pending, problem, save } = useSave();
  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="secondary"
        disabled={!connected || pending}
        onClick={() =>
          save(
            () => syncWhatsAppTemplates({}),
            (data) => toast(t("synced", { count: data.synced })),
          )
        }
      >
        <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} />
        {t("sync")}
      </Button>
      <FieldError>{problem ? tError(problem.key, problem.values) : undefined}</FieldError>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("templatesNone")}</p>
      ) : (
        templates.map((template) => <TemplateCard key={template.id} template={template} />)
      )}
    </div>
  );
}

function TemplateCard({ template }: { template: TemplateRow }) {
  const t = useTranslations("whatsapp.settings");
  const tFields = useTranslations("whatsapp.fields");
  const tError = useErrorMessage();
  const { pending, problem, save } = useSave();
  const [mapping, setMapping] = useState<Record<string, string>>(template.mapping);
  return (
    <Card className="flex flex-col gap-3 p-3.5" data-testid="wa-template">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold break-all">{template.name}</p>
        <Pill tone="grey">{template.language.toUpperCase()}</Pill>
        <Pill tone={TONE[template.metaStatus]}>{t(`templateStatus.${template.metaStatus}`)}</Pill>
      </div>
      <p className="rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line">
        {template.body}
      </p>
      {template.variables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noPlaceholders")}</p>
      ) : (
        <>
          {template.variables.map((variable) => (
            <Select
              key={variable}
              label={`${t("placeholder", { number: variable })} · ${t("fillWith")}`}
              value={mapping[variable] ?? ""}
              onChange={(event) => setMapping({ ...mapping, [variable]: event.target.value })}
              options={[
                { value: "", label: t("choose") },
                ...TEMPLATE_FIELDS.map((field) => ({ value: field, label: tFields(field) })),
              ]}
            />
          ))}
          <FieldError>{problem ? tError(problem.key, problem.values) : undefined}</FieldError>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              save(
                () =>
                  saveWhatsAppTemplateMapping({
                    templateId: template.id,
                    mapping: Object.fromEntries(
                      Object.entries(mapping).filter(([, field]) => field !== ""),
                    ),
                  }),
                () => toast(t("saved")),
              )
            }
          >
            {t("saveMapping")}
          </Button>
        </>
      )}
    </Card>
  );
}

export function AutomaticForm({
  value,
  templates,
}: {
  value: AutomaticSettings;
  templates: { id: string; label: string }[];
}) {
  const t = useTranslations("whatsapp.settings");
  const tError = useErrorMessage();
  const { pending, problem, save } = useSave();
  const [state, setState] = useState(value);
  return (
    <div className="flex flex-col gap-3">
      {AUTOMATIC.map((kind) => (
        <Card key={kind} className="flex flex-col gap-3 p-3.5" data-testid={`wa-auto-${kind}`}>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={state[kind].enabled}
              onChange={(event) =>
                setState({ ...state, [kind]: { ...state[kind], enabled: event.target.checked } })
              }
              className="mt-0.5 size-5.5 shrink-0 accent-primary"
            />
            <span>
              <span className="block font-bold">{t(kind)}</span>
              <span className="block text-sm text-muted-foreground">{t(`${kind}Hint`)}</span>
            </span>
          </label>
          <Select
            label={t("template")}
            value={state[kind].templateId ?? ""}
            onChange={(event) =>
              setState({
                ...state,
                [kind]: { ...state[kind], templateId: event.target.value || null },
              })
            }
            options={[
              { value: "", label: t("choose") },
              ...templates.map((item) => ({ value: item.id, label: item.label })),
            ]}
            error={
              problem?.field === `${kind}.templateId`
                ? tError(problem.key, problem.values)
                : undefined
            }
          />
        </Card>
      ))}
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          save(
            () =>
              saveAutomaticWhatsApp({
                thankYou: {
                  enabled: state.thankYou.enabled,
                  templateId: state.thankYou.templateId ?? "",
                },
                visitReminder: {
                  enabled: state.visitReminder.enabled,
                  templateId: state.visitReminder.templateId ?? "",
                },
                occasion: {
                  enabled: state.occasion.enabled,
                  templateId: state.occasion.templateId ?? "",
                },
              }),
            () => toast(t("saved")),
          )
        }
      >
        {t("saveAutomatic")}
      </Button>
    </div>
  );
}
