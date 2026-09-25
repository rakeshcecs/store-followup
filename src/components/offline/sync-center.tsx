"use client";

import { AlertCircle, Clock, Link2, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useOfflineData } from "@/components/offline/hooks";
import { syncNow } from "@/components/offline/sync-agent";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput } from "@/components/ui/text-input";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useOnline } from "@/hooks/use-online";
import type { Locale } from "@/i18n/config";
import {
  changeBillNumber,
  discardEntry,
  moveToExistingCustomer,
  saveAnyway,
} from "@/lib/offline/fix";
import { formatDateTime } from "@/lib/format";
import type { OfflineCache, OutboxEntry } from "@/lib/offline/types";
import { dependentsOf, type OfflineView } from "@/lib/offline/view";

const BILL_MAX = 30;

// Who an entry is about, from what the phone knows.
function customerName(entry: OutboxEntry, cache: OfflineCache, view: OfflineView): string {
  const input = entry.input;
  if (entry.kind === "customer") return String(input["name"] ?? "");
  if (entry.kind === "result") {
    const id = String(input["id"]);
    const cached = cache.followUps.find((row) => row.id === id);
    if (cached) return cached.customerName;
    return [...view.customers.values()].find((row) => row.pending?.id === id)?.name ?? "";
  }
  return view.customers.get(String(input["customerId"]))?.name ?? "";
}

// M19: the phone's outbox — "Needs your attention" first, with a way to fix each, then
// what is still waiting. The same list online (/sync) and in the offline workspace.
export function SyncCenter() {
  const t = useTranslations("sync.center");
  const tKind = useTranslations("sync.kind");
  const tEmpty = useTranslations("offlineApp.noData");
  const data = useOfflineData();
  const online = useOnline();
  const [syncing, startSync] = useTransition();

  if (data.state === "loading") return null;
  if (data.state === "empty") {
    return (
      <Card>
        <EmptyState title={tEmpty("title")} text={tEmpty("text")} />
      </Card>
    );
  }

  const { outbox, cache, view } = data;
  const attention = outbox.filter((entry) => entry.status === "attention");
  const waiting = outbox.filter((entry) => entry.status !== "attention");
  const label = (entry: OutboxEntry) =>
    tKind(entry.kind, {
      name: customerName(entry, cache, view),
      bill: String(
        (entry.input["sale"] as Record<string, unknown> | undefined)?.["billNumber"] ?? "",
      ),
    });
  const sync = () => startSync(async () => void (await syncNow(cache.branch?.id ?? null)));

  return (
    <div className="flex flex-col gap-5">
      {online && outbox.length > 0 && (
        <Button type="button" onClick={sync} disabled={syncing}>
          <RefreshCw aria-hidden className={syncing ? "animate-spin" : undefined} />
          {t("syncNow")}
        </Button>
      )}
      {!online && outbox.length > 0 && (
        <p className="text-sm text-muted-foreground">{t("offlineHint")}</p>
      )}

      {outbox.length === 0 && (
        <Card>
          <EmptyState title={t("empty")} />
        </Card>
      )}

      {attention.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="sync-attention">
          <h2 id="sync-attention" className="font-heading-style text-lg text-danger">
            {t("attention")}
          </h2>
          {attention.map((entry) => (
            <AttentionCard
              key={entry.id}
              entry={entry}
              label={label(entry)}
              dependents={dependentsOf(outbox, entry.id).length}
              onFixed={sync}
            />
          ))}
        </section>
      )}

      {waiting.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="sync-waiting">
          <h2 id="sync-waiting" className="font-heading-style text-lg">
            {t("waiting")}
          </h2>
          {waiting.map((entry) => (
            <EntryCard key={entry.id} entry={entry} label={label(entry)} />
          ))}
        </section>
      )}
    </div>
  );
}

function SavedAt({ entry }: { entry: OutboxEntry }) {
  const t = useTranslations("sync.center");
  const locale = useLocale() as Locale;
  return (
    <p className="text-sm text-muted-foreground">
      {t("savedAt", { time: formatDateTime(entry.at, locale) })}
    </p>
  );
}

function EntryCard({ entry, label }: { entry: OutboxEntry; label: string }) {
  const t = useTranslations("sync.center");
  return (
    <Card className="flex items-start gap-3 p-3.5" data-testid="outbox-entry">
      {entry.status === "blocked" ? (
        <Link2 aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      ) : (
        <Clock aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 grow">
        <p className="font-bold break-words">{label}</p>
        <SavedAt entry={entry} />
        {entry.status === "blocked" && (
          <p className="text-sm text-muted-foreground">{t("blocked")}</p>
        )}
      </div>
    </Card>
  );
}

function AttentionCard({
  entry,
  label,
  dependents,
  onFixed,
}: {
  entry: OutboxEntry;
  label: string;
  dependents: number;
  onFixed: () => void;
}) {
  const t = useTranslations("sync.center");
  const tError = useErrorMessage();
  const [bill, setBill] = useState<string | null>(null);
  const problem = entry.problem;
  const reason = problem?.reason;
  const existingId = problem?.values?.["id"];

  const fix = (run: () => Promise<void>) => () => void run().then(onFixed);

  return (
    <Card className="flex flex-col gap-3 border-danger-light p-3.5" data-testid="attention-entry">
      <div className="flex items-start gap-3">
        <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 grow">
          <p className="font-bold break-words">{label}</p>
          <SavedAt entry={entry} />
          {problem && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {tError(problem.message, problem.values)}
            </p>
          )}
        </div>
      </div>

      {bill !== null && (
        <TextInput
          label={t("newBill")}
          value={bill}
          maxLength={BILL_MAX}
          autoComplete="off"
          className="font-bold uppercase"
          onChange={(event) => setBill(event.target.value.toUpperCase())}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {reason === "mobileTaken" && typeof existingId === "string" && (
          <Button
            type="button"
            size="sm"
            onClick={fix(() => moveToExistingCustomer(entry.id, existingId))}
          >
            {t("useExisting")}
          </Button>
        )}
        {reason === "billTaken" &&
          (bill === null ? (
            <Button type="button" size="sm" onClick={() => setBill("")}>
              {t("changeBill")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={!bill.trim()}
              onClick={fix(() => changeBillNumber(entry.id, bill))}
            >
              {t("send")}
            </Button>
          ))}
        {reason === "customerChanged" && (
          <Button type="button" size="sm" onClick={fix(() => saveAnyway(entry.id))}>
            {t("saveAnyway")}
          </Button>
        )}
        <ConfirmDialog
          trigger={
            <Button type="button" size="sm" variant="secondary">
              {t("discard")}
            </Button>
          }
          title={t("discardTitle")}
          description={t("discardText", { count: dependents })}
          confirmLabel={t("discard")}
          cancelLabel={t("keep")}
          danger
          onConfirm={fix(() => discardEntry(entry.id))}
        />
      </div>
    </Card>
  );
}
