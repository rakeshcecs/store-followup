import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import { getUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { loadImportJob } from "@/lib/import/jobs";
import { resultXlsx } from "@/lib/import/files";
import type { Outcome } from "@/lib/import/types";

export const runtime = "nodejs";

// M24.05: every row that was not imported (or was, with a note) and why.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const job = user.role === "SALESPERSON" ? null : await loadImportJob(user, id);
  if (!job || job.status !== "DONE") return new Response(null, { status: 404 });

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("import");
  const tApp = await getTranslations("app");
  const lines = [
    t("result.branch", { branch: job.branchName }),
    t("result.by", { name: job.uploaderName, time: formatDateTime(job.createdAt, locale) }),
    t("result.counts", {
      total: job.totalRows,
      imported: job.imported,
      updated: job.updated,
      skipped: job.skipped + job.errorRows,
    }),
  ];
  const body = await resultXlsx(
    locale,
    { storeName: tApp("storeName"), fileName: job.fileName, lines },
    (job.outcomes ?? []) as unknown as Outcome[],
  );
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="import-result-${job.id}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
