import { Download } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UploadForm } from "@/app/(app)/import/upload-form";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { getBranchScope, getCurrentBranch, switchableBranches } from "@/lib/current-branch";
import { formatDateTime, formatNumber } from "@/lib/format";
import { recentImports } from "@/lib/import/jobs";
import { IMPORT_MAX_ROWS } from "@/lib/import/types";
import { ALL_BRANCHES } from "@/lib/permissions";

// M24: import customers from Excel — the template, the upload, and earlier imports.
// Manager for their own branches, admin for any (SOW permission table).
export default async function ImportPage() {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const t = await getTranslations("import");
  const tReports = await getTranslations("reports");
  const locale = (await getLocale()) as Locale;
  const [branches, choice, scope] = await Promise.all([
    switchableBranches(user),
    getCurrentBranch(user),
    getBranchScope(user),
  ]);
  const jobs = await recentImports(scope);

  return (
    <AppShell role={user.role} title={t("title")} backHref="/reports" backLabel={tReports("title")}>
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-heading-style text-lg">{t("step1")}</h2>
        <p className="text-[15px] text-muted-foreground">{t("step1Text")}</p>
        <Button asChild variant="secondary">
          <a href="/import/template" download>
            <Download aria-hidden />
            {t("template.download")}
          </a>
        </Button>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-heading-style text-lg">{t("step2")}</h2>
        <p className="text-[15px] text-muted-foreground">
          {t("step2Text", { max: formatNumber(IMPORT_MAX_ROWS, locale) })}
        </p>
        <UploadForm
          branches={branches.map((b) => ({ value: b.id, label: b.name }))}
          defaultBranch={choice === ALL_BRANCHES ? user.homeBranchId : choice}
        />
      </Card>

      <section className="flex flex-col gap-2.5">
        <h2 className="font-heading-style text-lg">{t("history")}</h2>
        {jobs.length === 0 ? (
          <Card>
            <EmptyState title={t("noHistory")} />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/import/${job.id}`}
                  data-testid="import-history-row"
                  className="flex flex-col gap-1 rounded-xl border border-border bg-card px-3.5 py-3 no-underline hover:bg-black/2"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-bold">{job.fileName}</span>
                    <Pill
                      tone={
                        job.status === "DONE" ? "green" : job.status === "FAILED" ? "red" : "grey"
                      }
                    >
                      {t(`status.${job.status}`)}
                    </Pill>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t("historyLine", {
                      time: formatDateTime(job.createdAt, locale),
                      name: job.uploaderName,
                      branch: job.branch.name,
                    })}
                  </span>
                  {job.status === "DONE" && (
                    <span className="text-sm">
                      {t("summary", {
                        imported: job.imported,
                        updated: job.updated,
                        skipped: job.skipped + job.errorRows,
                      })}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
