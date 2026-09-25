import { getLocale, getTranslations } from "next-intl/server";
import type { NextRequest } from "next/server";
import type { Locale } from "@/i18n/config";
import { AUDIT, writeAudit } from "@/lib/audit";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { mainTable } from "@/lib/reports/core";
import { PDF_MAX_ROWS, toPdf } from "@/lib/reports/pdf";
import { canExport, filterLines, runReport } from "@/lib/reports/run";
import { toXlsx } from "@/lib/reports/xlsx";

// pdfkit and exceljs need Node, not the edge runtime.
export const runtime = "nodejs";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

// M13 export: the same rows the screen shows for these filters — all of them, not one
// page — as .xlsx or .pdf. Managers and admins only (M13.02), and every export is written
// to the audit log (module prompt).
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const user = await getUser();
  if (!user) return new Response(null, { status: 401 });
  const { code } = await params;
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const format = query["format"];
  if (!canExport(user) || (format !== "xlsx" && format !== "pdf")) {
    return new Response(null, { status: 404 });
  }

  const locale = (await getLocale()) as Locale;
  const ran = await runReport(user, code, query, locale);
  if (!ran) return new Response(null, { status: 404 });

  const t = await getTranslations("reports");
  const tApp = await getTranslations("app");
  const meta = {
    storeName: tApp("storeName"),
    title: t(`names.${ran.def.code}`),
    lines: await filterLines(user, ran),
    exportedAt: t("exportedAt", { time: formatDateTime(new Date(), locale) }),
  };
  let body: Buffer;
  if (format === "xlsx") {
    body = await toXlsx(meta, ran.result);
  } else {
    const main = mainTable(ran.result);
    const total = main?.rows.length ?? 0;
    if (main && total > PDF_MAX_ROWS) {
      main.rows = main.rows.slice(0, PDF_MAX_ROWS);
      meta.lines.push(t("pdfCapped", { count: PDF_MAX_ROWS, total }));
    }
    body = await toPdf(meta, ran.result, locale);
  }

  await writeAudit(db, {
    userId: user.id,
    branchId: ran.ctx.scope.all ? null : (ran.ctx.scope.branchIds[0] ?? null),
    action: AUDIT.reportExport,
    entityType: "Report",
    entityId: ran.def.code,
    newValue: {
      format,
      range: ran.def.dateRange ? ran.ctx.range : null,
      filters: { ...ran.ctx.filters, page: undefined },
      branches: ran.ctx.scope.all ? "all" : ran.ctx.scope.branchIds,
    },
    device: request.headers.get("user-agent"),
  });

  const name = ran.def.dateRange
    ? `${ran.def.code}-${ran.ctx.range.from}-${ran.ctx.range.to}.${format}`
    : `${ran.def.code}.${format}`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
