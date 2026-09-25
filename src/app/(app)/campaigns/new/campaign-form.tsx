"use client";

import { Search, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import { OptionList } from "@/components/ui/option-list";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { createCampaign, previewCampaign } from "@/lib/actions/campaign";
import type { MessageValues } from "@/lib/errors";
import { createCampaignInput, previewCampaignInput } from "@/lib/validation/campaign";
import { CAMPAIGN_FIELDS, type CampaignVariables } from "@/lib/whatsapp/fields";
import { renderBody } from "@/lib/whatsapp/render";

type Option = { value: string; label: string };
type Template = {
  id: string;
  name: string;
  language: string;
  body: string;
  variables: string[];
  mapping: Record<string, string>;
};
type Festival = { id: string; name: string; date: string; label: string };

type Preview = {
  counts: {
    matched: number;
    noConsent: number;
    weeklyLimit: number;
    missingField: number;
    ready: number;
  };
  sample: { id: string; name: string; mobile: string }[];
};

type Problem = { key: string; values?: MessageValues; field?: string } | null;

const TEXT = "__text";
const INTENTS = ["HOT", "WARM", "COLD"] as const;
// Value sent to the action → its label key.
const BOUGHT_OPTIONS = [
  { value: "", key: "boughtAny" },
  { value: "yes", key: "boughtYes" },
  { value: "no", key: "boughtNo" },
] as const;
type Bought = (typeof BOUGHT_OPTIONS)[number]["value"];
const WHEN = ["now", "later"] as const;
type When = (typeof WHEN)[number];
type Field = (typeof CAMPAIGN_FIELDS)[number];
// The fields whose error shows under their own input; anything else shows at the bottom.
const OWN_ERROR_FIELDS = [
  "name",
  "branch",
  "templateId",
  "variables",
  "scheduledAt",
  "filters.lastVisitTo",
  "filters.boughtTo",
  "filters.occasionWithinDays",
];

const textVariable = (text: string): CampaignVariables[string] => ({ kind: "text", text });
const fieldVariable = (field: Field): CampaignVariables[string] => ({ kind: "field", field });

// The IST wall time typed into <input type="datetime-local"> as an instant.
export function istInstant(local: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return undefined;
  const date = new Date(`${local}:00.000+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function CampaignForm({
  branches,
  defaultBranch,
  templates,
  categories,
  departments,
  reasons,
  festivals,
}: {
  branches: Option[];
  defaultBranch: string;
  templates: Template[];
  categories: Option[];
  departments: Option[];
  reasons: Option[];
  festivals: Festival[];
}) {
  const t = useTranslations("campaigns");
  const tFields = useTranslations("whatsapp.fields");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<Problem>(null);

  const [name, setName] = useState("");
  const [branch, setBranch] = useState(defaultBranch);
  const [festivalId, setFestivalId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<CampaignVariables>({});
  const [filters, setFilters] = useState({
    categoryIds: [] as string[],
    departmentId: "",
    lastVisitFrom: "",
    lastVisitTo: "",
    bought: "" as Bought,
    boughtFrom: "",
    boughtTo: "",
    lostReasonId: "",
    intent: "",
    occasionWithinDays: "",
  });
  const [when, setWhen] = useState<When>(WHEN[0]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [preview, setPreview] = useState<{ key: string; result: Preview } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const template = templates.find((item) => item.id === templateId) ?? null;

  // What the preview and the save send; also the key that tells whether the preview
  // still matches what is on the screen.
  const audience = () => ({
    branch,
    templateId,
    variables,
    filters: {
      categoryIds: filters.categoryIds,
      departmentId: filters.departmentId,
      lastVisitFrom: filters.lastVisitFrom,
      lastVisitTo: filters.lastVisitTo,
      bought: filters.bought || undefined,
      boughtFrom: filters.boughtFrom,
      boughtTo: filters.boughtTo,
      lostReasonId: filters.lostReasonId,
      intent: filters.intent || undefined,
      occasionWithinDays: filters.occasionWithinDays,
    },
  });
  const audienceKey = JSON.stringify(audience());
  const previewCurrent = preview !== null && preview.key === audienceKey;

  function pickTemplate(id: string) {
    setTemplateId(id);
    const picked = templates.find((item) => item.id === id);
    // Start from the admin's mapping where a campaign can use it; the rest is typed.
    const next: CampaignVariables = {};
    for (const variable of picked?.variables ?? []) {
      const field = picked?.mapping[variable];
      next[variable] =
        field && (CAMPAIGN_FIELDS as readonly string[]).includes(field)
          ? fieldVariable(field as Field)
          : textVariable("");
    }
    setVariables(next);
  }

  function pickFestival(id: string) {
    setFestivalId(id);
    const festival = festivals.find((item) => item.id === id);
    if (!festival) return;
    if (!name.trim()) setName(festival.name);
    setWhen(WHEN[1]);
    setScheduledAt(`${festival.date}T10:30`);
  }

  // The message as one customer would read it: fixed texts as typed, fields in «».
  const rendered = template
    ? renderBody(
        template.body,
        template.variables,
        template.variables.map((variable) => {
          const value = variables[variable];
          if (!value) return `{{${variable}}}`;
          return value.kind === "text"
            ? value.text || `{{${variable}}}`
            : `«${tFields(value.field)}»`;
        }),
      )
    : "";

  function fail(key: string, values?: MessageValues, field?: string) {
    setProblem({ key, values, field });
  }

  function check() {
    setProblem(null);
    const parsed = previewCampaignInput.safeParse(audience());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail(issue?.message ?? "errors.validation", undefined, issue?.path.join("."));
      return;
    }
    const key = audienceKey;
    startTransition(async () => {
      const result = await previewCampaign(parsed.data);
      if (!result.ok) {
        fail(result.message, result.values, result.field);
        return;
      }
      setPreview({ key, result: result.data });
    });
  }

  function input() {
    return {
      ...audience(),
      name,
      scheduledAt: when === "later" ? (istInstant(scheduledAt) ?? scheduledAt) : "",
    };
  }

  function askConfirm() {
    setProblem(null);
    if (!previewCurrent) {
      fail("campaigns.errors.previewFirst");
      return;
    }
    const parsed = createCampaignInput.safeParse(input());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail(issue?.message ?? "errors.validation", undefined, issue?.path.join("."));
      return;
    }
    if (when === "later" && new Date(parsed.data.scheduledAt ?? 0).getTime() < Date.now()) {
      fail("campaigns.errors.schedulePast", undefined, "scheduledAt");
      return;
    }
    setConfirming(true);
  }

  function save() {
    startTransition(async () => {
      const result = await createCampaign(input());
      if (!result.ok) {
        fail(result.message, result.values, result.field);
        return;
      }
      toast(t("created"));
      router.push(`/campaigns/${result.data.id}`);
    });
  }

  const errorFor = (field: string) =>
    problem?.field === field ? tError(problem.key, problem.values) : undefined;
  const ready = preview?.result.counts.ready ?? 0;
  const whenText =
    when === "now" ? t("whenNow") : t("whenAt", { time: scheduledAt.replace("T", " ") });

  return (
    <div className="flex flex-col gap-5" data-testid="campaign-form">
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-heading-style text-lg">{t("steps.name")}</h2>
        {festivals.length > 0 && (
          <Select
            label={t("festivalPick")}
            value={festivalId}
            onChange={(event) => pickFestival(event.target.value)}
            options={[
              { value: "", label: t("festivalNone") },
              ...festivals.map((festival) => ({ value: festival.id, label: festival.label })),
            ]}
          />
        )}
        <TextInput
          name="name"
          label={t("name")}
          placeholder={t("namePlaceholder")}
          maxLength={150}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errorFor("name")}
        />
        <Select
          name="branch"
          label={t("branch")}
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          options={branches}
          disabled={branches.length < 2}
          error={errorFor("branch")}
        />
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-heading-style text-lg">{t("steps.template")}</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("templatesEmpty")}</p>
        ) : (
          <OptionList
            label={t("template")}
            value={templateId}
            onValueChange={pickTemplate}
            options={templates.map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.language.toUpperCase()}`,
              description: item.body,
            }))}
          />
        )}
        <FieldError>{errorFor("templateId")}</FieldError>
        {template &&
          template.variables.map((variable) => {
            const value = variables[variable];
            return (
              <div key={variable} className="flex flex-col gap-2" data-testid="campaign-variable">
                <Select
                  label={`${t("placeholder", { number: variable })} · ${t("fillWith")}`}
                  value={value?.kind === "field" ? value.field : TEXT}
                  onChange={(event) =>
                    setVariables({
                      ...variables,
                      [variable]:
                        event.target.value === TEXT
                          ? textVariable(value?.kind === "text" ? value.text : "")
                          : fieldVariable(event.target.value as Field),
                    })
                  }
                  options={[
                    { value: TEXT, label: t("sameText") },
                    ...CAMPAIGN_FIELDS.map((field) => ({ value: field, label: tFields(field) })),
                  ]}
                />
                {(!value || value.kind === "text") && (
                  <TextInput
                    label={t("text")}
                    maxLength={200}
                    value={value?.kind === "text" ? value.text : ""}
                    onChange={(event) =>
                      setVariables({ ...variables, [variable]: textVariable(event.target.value) })
                    }
                  />
                )}
              </div>
            );
          })}
        <FieldError>{errorFor("variables")}</FieldError>
        {template && (
          <div>
            <p className="mb-1 text-sm font-bold text-ink-2">{t("previewSample")}</p>
            <p
              className="rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line"
              data-testid="message-preview"
            >
              {rendered}
            </p>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-heading-style text-lg">{t("steps.audience")}</h2>
        {categories.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-bold text-ink-2">{t("filters.categories")}</p>
            <ChoiceChips
              type="multiple"
              label={t("filters.categories")}
              options={categories}
              value={filters.categoryIds}
              onValueChange={(categoryIds) => setFilters({ ...filters, categoryIds })}
            />
          </div>
        )}
        <Select
          label={t("filters.department")}
          value={filters.departmentId}
          onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })}
          options={[{ value: "", label: t("filters.any") }, ...departments]}
        />
        <fieldset className="grid grid-cols-2 gap-2.5">
          <legend className="mb-2 text-sm font-bold text-ink-2">{t("filters.lastVisit")}</legend>
          <TextInput
            type="date"
            label={t("filters.from")}
            value={filters.lastVisitFrom}
            onChange={(event) => setFilters({ ...filters, lastVisitFrom: event.target.value })}
          />
          <TextInput
            type="date"
            label={t("filters.to")}
            value={filters.lastVisitTo}
            onChange={(event) => setFilters({ ...filters, lastVisitTo: event.target.value })}
            error={errorFor("filters.lastVisitTo")}
          />
        </fieldset>
        <Select
          label={t("filters.bought")}
          value={filters.bought}
          onChange={(event) => setFilters({ ...filters, bought: event.target.value as Bought })}
          options={BOUGHT_OPTIONS.map((option) => ({
            value: option.value,
            label: t(`filters.${option.key}`),
          }))}
        />
        {filters.bought && (
          <fieldset className="grid grid-cols-2 gap-2.5">
            <legend className="mb-2 text-sm font-bold text-ink-2">
              {t("filters.boughtPeriod")}
            </legend>
            <TextInput
              type="date"
              label={t("filters.from")}
              value={filters.boughtFrom}
              onChange={(event) => setFilters({ ...filters, boughtFrom: event.target.value })}
            />
            <TextInput
              type="date"
              label={t("filters.to")}
              value={filters.boughtTo}
              onChange={(event) => setFilters({ ...filters, boughtTo: event.target.value })}
              error={errorFor("filters.boughtTo")}
            />
          </fieldset>
        )}
        <Select
          label={t("filters.lostReason")}
          value={filters.lostReasonId}
          onChange={(event) => setFilters({ ...filters, lostReasonId: event.target.value })}
          options={[{ value: "", label: t("filters.any") }, ...reasons]}
        />
        <Select
          label={t("filters.intent")}
          value={filters.intent}
          onChange={(event) => setFilters({ ...filters, intent: event.target.value })}
          options={[
            { value: "", label: t("filters.any") },
            ...INTENTS.map((intent) => ({ value: intent, label: t(`intent.${intent}`) })),
          ]}
        />
        <TextInput
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          label={t("filters.occasionWithin")}
          value={filters.occasionWithinDays}
          onChange={(event) => setFilters({ ...filters, occasionWithinDays: event.target.value })}
          error={errorFor("filters.occasionWithinDays")}
        />
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-heading-style text-lg">{t("steps.preview")}</h2>
        <Button type="button" variant="secondary" onClick={check} disabled={pending || !templateId}>
          <Search aria-hidden />
          {pending ? t("checking") : t("check")}
        </Button>
        {preview && (
          <div className="flex flex-col gap-2" data-testid="campaign-preview">
            <p className="text-[15px]" data-testid="preview-counts">
              {t("counts.match", { count: preview.result.counts.matched })}{" "}
              {t("counts.noConsent", { count: preview.result.counts.noConsent })}{" "}
              {t("counts.weeklyLimit", { count: preview.result.counts.weeklyLimit })}
              {preview.result.counts.missingField > 0 &&
                ` ${t("counts.missingField", { count: preview.result.counts.missingField })}`}
            </p>
            <p className="font-bold" data-testid="preview-ready">
              {t("counts.ready", { count: preview.result.counts.ready })}
            </p>
            {preview.result.sample.length > 0 && (
              <>
                <p className="text-sm font-bold text-ink-2">{t("sample")}</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {preview.result.sample.map((customer) => (
                    <li key={customer.id} data-testid="preview-sample">
                      {customer.name} · {customer.mobile.slice(0, 5)} {customer.mobile.slice(5)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!previewCurrent && (
              <p className="text-sm text-warning" data-testid="preview-stale">
                {t("previewStale")}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-heading-style text-lg">{t("steps.schedule")}</h2>
        <OptionList
          label={t("steps.schedule")}
          value={when}
          onValueChange={(value) => setWhen(value === WHEN[1] ? WHEN[1] : WHEN[0])}
          options={WHEN.map((value) => ({ value, label: t(`when.${value}`) }))}
        />
        {when === WHEN[1] && (
          <TextInput
            type="datetime-local"
            name="scheduledAt"
            label={t("scheduledAt")}
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            error={errorFor("scheduledAt")}
          />
        )}
        <FieldError>
          {problem && !OWN_ERROR_FIELDS.includes(problem.field ?? "")
            ? tError(problem.key, problem.values)
            : undefined}
        </FieldError>
        <Button
          type="button"
          onClick={askConfirm}
          disabled={pending || !previewCurrent || ready === 0}
        >
          <Send aria-hidden />
          {when === "now" ? t("confirmNow") : t("confirm")}
        </Button>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t("confirmTitle")}
          description={t("confirmText", { count: ready, name, when: whenText })}
          confirmLabel={when === "now" ? t("confirmNow") : t("confirm")}
          cancelLabel={t("keep")}
          onConfirm={save}
        />
      </Card>
    </div>
  );
}
