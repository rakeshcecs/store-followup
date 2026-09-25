"use client";

import { CalendarPlus, Check, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ZodType } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import {
  addFestival,
  prefillCommonFestivals,
  removeFestival,
  updateFestival,
} from "@/lib/actions/festival";
import type { ActionResult, MessageValues } from "@/lib/errors";
import { festivalInput, updateFestivalInput } from "@/lib/validation/festival";

type Option = { value: string; label: string };
type Festival = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  dateLabel: string;
  branchId: string | null;
  branchName: string | null;
  confirmed: boolean;
};
type Problem = { key: string; values?: MessageValues; field?: string } | null;

const ALL = "all"; // the "every branch" choice, as src/lib/validation/festival.ts spells it

// One action → toast, or the problem to show; the schema runs first so the exact message
// shows (the action only says which field). Same shape as the WhatsApp settings screen.
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
  function valid(schema: ZodType, value: unknown): boolean {
    const parsed = schema.safeParse(value);
    if (parsed.success) return true;
    const issue = parsed.error.issues[0];
    setProblem({ key: issue?.message ?? "errors.validation", field: issue?.path.join(".") });
    return false;
  }
  return { pending, problem, save, valid };
}

function FestivalFields({
  value,
  onChange,
  branches,
  problem,
}: {
  value: { name: string; date: string; branch: string };
  onChange: (next: { name: string; date: string; branch: string }) => void;
  branches: Option[];
  problem: Problem;
}) {
  const t = useTranslations("festivals");
  const tError = useErrorMessage();
  const errorFor = (field: string) =>
    problem?.field === field ? tError(problem.key, problem.values) : undefined;
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      <TextInput
        label={t("name")}
        maxLength={100}
        value={value.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
        error={errorFor("name")}
      />
      <TextInput
        type="date"
        label={t("date")}
        value={value.date}
        onChange={(event) => onChange({ ...value, date: event.target.value })}
        error={errorFor("date")}
      />
      <Select
        label={t("branch")}
        value={value.branch}
        onChange={(event) => onChange({ ...value, branch: event.target.value })}
        options={[{ value: ALL, label: t("allBranches") }, ...branches]}
        error={errorFor("branch")}
      />
    </div>
  );
}

export function FestivalList({
  festivals,
  branches,
  canPrefill,
  years,
}: {
  festivals: Festival[];
  branches: Option[];
  canPrefill: boolean;
  years: { year: number; next: number };
}) {
  const t = useTranslations("festivals");
  const tError = useErrorMessage();
  const { pending, problem, save, valid } = useSave();
  const empty = { name: "", date: "", branch: ALL };
  const [draft, setDraft] = useState(empty);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2.5">
        {canPrefill && (
          <Button
            type="button"
            variant="secondary"
            className="grow"
            disabled={pending}
            onClick={() =>
              save(
                () => prefillCommonFestivals({}),
                (data) => toast(t("prefilled", { count: data.added })),
              )
            }
          >
            <CalendarPlus aria-hidden />
            {t("prefill", years)}
          </Button>
        )}
        <Button type="button" className="grow" disabled={pending} onClick={() => setAdding(true)}>
          {t("add")}
        </Button>
      </div>
      {adding && (
        <Card className="flex flex-col gap-3 p-3.5" data-testid="festival-add">
          <FestivalFields value={draft} onChange={setDraft} branches={branches} problem={problem} />
          <div className="flex gap-2.5">
            <Button
              type="button"
              className="grow"
              disabled={pending}
              onClick={() => {
                if (!valid(festivalInput, draft)) return;
                save(
                  () => addFestival(draft),
                  () => {
                    toast(t("saved"));
                    setDraft(empty);
                    setAdding(false);
                  },
                );
              }}
            >
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="grow"
              disabled={pending}
              onClick={() => setAdding(false)}
            >
              {t("keep")}
            </Button>
          </div>
        </Card>
      )}
      <FieldError>
        {problem && !adding ? tError(problem.key, problem.values) : undefined}
      </FieldError>
      {festivals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {festivals.map((festival) => (
            <FestivalRow key={festival.id} festival={festival} branches={branches} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FestivalRow({ festival, branches }: { festival: Festival; branches: Option[] }) {
  const t = useTranslations("festivals");
  const tError = useErrorMessage();
  const { pending, problem, save, valid } = useSave();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: festival.name,
    date: festival.date,
    branch: festival.branchId ?? ALL,
  });

  const submit = (confirmed: boolean) => {
    const input = { id: festival.id, ...draft, confirmed };
    if (!valid(updateFestivalInput, input)) return;
    save(
      () => updateFestival(input),
      () => {
        toast(t("saved"));
        setEditing(false);
      },
    );
  };

  return (
    <li>
      <Card className="flex flex-col gap-2.5 p-3.5" data-testid="festival-row">
        <div className="flex items-center gap-2">
          <span className="min-w-0 grow">
            <span className="block font-bold">{festival.name}</span>
            <span className="block text-sm text-muted-foreground">
              {festival.dateLabel} · {festival.branchName ?? t("allBranches")}
            </span>
          </span>
          <Pill tone={festival.confirmed ? "green" : "amber"} data-testid="festival-confirmed">
            {festival.confirmed ? t("confirmed") : t("unconfirmed")}
          </Pill>
        </div>
        {editing ? (
          <>
            <FestivalFields
              value={draft}
              onChange={setDraft}
              branches={branches}
              problem={problem}
            />
            <div className="flex gap-2.5">
              <Button
                type="button"
                className="grow"
                disabled={pending}
                onClick={() => submit(true)}
              >
                {t("save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="grow"
                disabled={pending}
                onClick={() => setEditing(false)}
              >
                {t("keep")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!festival.confirmed && (
              <Button type="button" size="sm" disabled={pending} onClick={() => submit(true)}>
                <Check aria-hidden />
                {t("confirm")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden />
              {t("edit")}
            </Button>
            <ConfirmDialog
              trigger={
                <Button type="button" size="sm" variant="secondary" disabled={pending}>
                  <Trash2 aria-hidden />
                  {t("remove")}
                </Button>
              }
              title={t("removeTitle", { name: festival.name })}
              description={t("removeText")}
              confirmLabel={t("removeConfirm")}
              cancelLabel={t("keep")}
              danger
              onConfirm={() =>
                save(
                  () => removeFestival({ id: festival.id }),
                  () => toast(t("removed")),
                )
              }
            />
          </div>
        )}
        <FieldError>
          {problem && !editing ? tError(problem.key, problem.values) : undefined}
        </FieldError>
      </Card>
    </li>
  );
}
