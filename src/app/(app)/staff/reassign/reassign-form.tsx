"use client";

import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { reassignCustomers } from "@/lib/actions/reassign";

type Option = { value: string; label: string };
export type ReassignFormRow = { id: string; name: string; detail: string; followUps: number };

type ReassignFormProps = {
  sources: Option[];
  from: { id: string; name: string } | null;
  targets: Option[];
  rows: ReassignFormRow[];
  preselected: string[];
  backTo: string | null; // a single customer from their profile goes back there
  exit: boolean; // staff exit: everything, then inactive (M15.02)
};

const PATH = "/staff/reassign";

export function ReassignForm({
  sources,
  from,
  targets,
  rows,
  preselected,
  backTo,
  exit,
}: ReassignFormProps) {
  const t = useTranslations("reassign");
  const tError = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected));
  const [toId, setToId] = useState("");
  const [confirming, setConfirming] = useState(false);

  const chosen = rows.filter((row) => selected.has(row.id));
  const followUps = chosen.reduce((sum, row) => sum + row.followUps, 0);
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const toName = targets.find((option) => option.value === toId)?.label ?? "";
  // The exit path moves everything or nothing: a half-moved leaver cannot be deactivated.
  const ready = from !== null && toId !== "" && chosen.length > 0 && (!exit || allChosen);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (!from) return;
    startTransition(async () => {
      const result = await reassignCustomers({
        fromId: from.id,
        toId,
        customerIds: chosen.map((row) => row.id),
        deactivate: exit,
      });
      if (!result.ok) {
        toast.error(tError(result.message, result.values));
        return;
      }
      const values = {
        customers: result.data.customers,
        followUps: result.data.followUps,
        from: from.name,
        to: toName,
      };
      toast(result.data.deactivated ? t("doneExit", values) : t("done", values));
      if (backTo) router.push(backTo);
      else if (result.data.deactivated) router.push("/staff");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Select
        label={t("from")}
        options={sources}
        placeholder={t("choosePerson")}
        value={from?.id ?? ""}
        disabled={exit || pending}
        onChange={(event) => router.push(`${PATH}?from=${event.target.value}`)}
      />

      {!from ? (
        <p className="text-muted-foreground">{t("pickFrom")}</p>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t("empty", { name: from.name })} />
        </Card>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2.5" disabled={pending}>
            <legend className="sr-only">{t("customers")}</legend>
            {!exit && rows.length > 1 && (
              <label className="flex items-center gap-3 px-1 text-[15px] font-bold">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={allChosen}
                  onChange={() =>
                    setSelected(allChosen ? new Set() : new Set(rows.map((row) => row.id)))
                  }
                />
                {t("selectAll", { count: rows.length })}
              </label>
            )}
            {rows.map((row) => (
              <label
                key={row.id}
                data-testid="reassign-row"
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 has-checked:border-primary"
              >
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={selected.has(row.id)}
                  disabled={exit}
                  onChange={() => toggle(row.id)}
                />
                <span className="min-w-0">
                  <span className="block font-bold">{row.name}</span>
                  <span className="block text-sm text-muted-foreground">{row.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {targets.length === 0 ? (
            <p className="text-[15px] text-danger">{t("noTargets")}</p>
          ) : (
            <Select
              label={t("to")}
              options={targets}
              placeholder={t("choosePerson")}
              value={toId}
              disabled={pending}
              onChange={(event) => setToId(event.target.value)}
            />
          )}

          <Button disabled={!ready || pending} onClick={() => setConfirming(true)}>
            <ArrowRightLeft aria-hidden />
            {exit ? t("submitExit", { name: from.name }) : t("submit", { count: chosen.length })}
          </Button>

          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t("confirmTitle")}
            description={
              t("confirmText", {
                customers: chosen.length,
                followUps,
                from: from.name,
                to: toName,
              }) + (exit ? ` ${t("confirmExit", { name: from.name })}` : "")
            }
            confirmLabel={t("confirm")}
            cancelLabel={t("cancel")}
            danger={exit}
            onConfirm={submit}
          />
        </>
      )}
    </div>
  );
}
