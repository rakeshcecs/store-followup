import { FileSpreadsheet } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/app/(app)/import/[id]/confirm-form";
import { ImportProgress } from "@/app/(app)/import/[id]/import-progress";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatMobile } from "@/lib/format";
import { loadImportJob } from "@/lib/import/jobs";
import { workRows } from "@/lib/import/run";
import type { ImportRow, Message } from "@/lib/import/types";
import { cn } from "@/lib/utils";

const TABS = ["ready", "error", "exists"] as const;
type Tab = (typeof TABS)[number];
const PAGE = 50;

const isTab = (value: string | undefined): value is Tab => TABS.includes(value as Tab);

// M24 preview → progress → result, all on one address, by the job's status.
export default async function ImportJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const { id } = await params;
  const query = await searchParams;
  const job = await loadImportJob(user, id);
  if (!job) notFound();
  const t = await getTranslations("import");
  const tAll = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const say = (message: Message) =>
    tAll.has(message.key as Parameters<typeof tAll>[0])
      ? tAll(message.key as Parameters<typeof tAll>[0], message.values ?? {})
      : message.key;
  const separator = "; ";

  const header = (
    <Card className="flex flex-col gap-1 p-4">
      <h2 className="font-heading-style text-lg break-all">{job.fileName}</h2>
      <p className="text-sm text-muted-foreground">
        {t("historyLine", {
          time: formatDateTime(job.createdAt, locale),
          name: job.uploaderName,
          branch: job.branchName,
        })}
      </p>
    </Card>
  );

  if (job.status === "PENDING") {
    const rows = (job.rows ?? []) as unknown as ImportRow[];
    const tab: Tab = isTab(query.tab) ? query.tab : "ready";
    const inTab = rows.filter((row) => row.state === tab);
    const pages = Math.max(1, Math.ceil(inTab.length / PAGE));
    const page = Math.min(Math.max(1, Number(query.page) || 1), pages);
    const shown = inTab.slice((page - 1) * PAGE, page * PAGE);
    const counts: Record<Tab, number> = {
      ready: job.readyRows,
      error: job.errorRows,
      exists: job.existingRows,
    };
    const whatsappRows = rows.filter((row) => row.state !== "error" && row.whatsapp).length;
    const pageHref = (to: number) => `/import/${job.id}?tab=${tab}&page=${to}`;
    return (
      <AppShell
        role={user.role}
        title={t("previewTitle")}
        backHref="/import"
        backLabel={t("title")}
      >
        {header}
        <nav className="grid grid-cols-3 gap-2" aria-label={t("tabs.label")}>
          {TABS.map((name) => (
            <Link
              key={name}
              href={`/import/${job.id}?tab=${name}`}
              aria-current={name === tab ? "page" : undefined}
              data-testid={`tab-${name}`}
              className={cn(
                "rounded-xl border px-2 py-2.5 text-center text-sm font-bold no-underline",
                name === tab
                  ? "border-primary bg-primary-light text-primary"
                  : "border-border bg-card",
              )}
            >
              {t(`tabs.${name}`, { count: counts[name] })}
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <Card>
            <EmptyState title={t(`tabs.empty.${tab}`)} />
          </Card>
        ) : (
          <Card className="shrink-0 overflow-x-auto p-0">
            <table className="w-full text-[14px]">
              <thead className="border-b border-border text-left text-[13px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5">{t("result.line")}</th>
                  <th className="px-3 py-2.5">{t("columns.name")}</th>
                  <th className="px-3 py-2.5">{t("columns.mobile")}</th>
                  <th className="px-3 py-2.5">
                    {tab === "error" ? t("result.reason") : t("notesTitle")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr
                    key={row.line}
                    className="border-b border-border last:border-0"
                    data-testid="preview-row"
                  >
                    <td className="px-3 py-2.5 tabular-nums">{row.line}</td>
                    <td className="px-3 py-2.5 font-bold">{row.name}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {/^[6-9]\d{9}$/.test(row.mobile) ? formatMobile(row.mobile) : row.mobile}
                    </td>
                    <td className={cn("px-3 py-2.5", tab === "error" && "text-danger")}>
                      {(tab === "error" ? row.errors : row.notes).map(say).join(separator)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        {pages > 1 && (
          <nav className="flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="font-bold text-primary">
                {t("previous")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-muted-foreground">{t("page", { page, pages })}</span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="font-bold text-primary">
                {t("next")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
        <ConfirmForm
          jobId={job.id}
          ready={job.readyRows}
          existing={job.existingRows}
          mistakes={job.errorRows}
          whatsappRows={whatsappRows}
        />
      </AppShell>
    );
  }

  const work = workRows((job.rows ?? []) as unknown as ImportRow[]).length;
  const results = [
    { key: "imported", value: job.imported },
    { key: "updated", value: job.updated },
    { key: "skipped", value: job.skipped },
    { key: "mistakes", value: job.errorRows },
  ] as const;
  return (
    <AppShell role={user.role} title={t("title")} backHref="/import" backLabel={t("title")}>
      {header}
      {job.status === "PROCESSING" && <ImportProgress processed={job.processed} total={work} />}
      {job.status === "DONE" && (
        <Card className="flex flex-col gap-3 p-4" data-testid="import-result">
          <h2 className="font-heading-style text-lg">{t("done")}</h2>
          <dl className="grid grid-cols-2 gap-2 text-[15px] sm:grid-cols-4">
            {results.map((result) => (
              <div
                key={result.key}
                className="rounded-xl bg-grey-light p-3"
                data-testid={`count-${result.key}`}
              >
                <dt className="text-sm text-muted-foreground">{t(`counts.${result.key}`)}</dt>
                <dd className="text-2xl font-extrabold tabular-nums">{result.value}</dd>
              </div>
            ))}
          </dl>
          <Button asChild variant="secondary">
            <a href={`/import/${job.id}/result`} download>
              <FileSpreadsheet aria-hidden />
              {t("resultFile")}
            </a>
          </Button>
        </Card>
      )}
      {job.status === "FAILED" && (
        <Card className="p-4 text-danger" role="alert">
          {t("failed")}
        </Card>
      )}
      {job.status === "CANCELLED" && (
        <Card className="p-4 text-muted-foreground">{t("cancelled")}</Card>
      )}
    </AppShell>
  );
}
