// Running a report for a signed-in person: who may open which report, over which
// branches, and the filter lines printed on an export. Shared by the report screen and
// the export route so both always show the same rows.
import type { SessionUser } from "@/lib/auth";
import type { Locale } from "@/i18n/config";
import { getBranchScope, getCurrentBranch, getCurrentBranchName } from "@/lib/current-branch";
import { dayForDisplay } from "@/lib/follow-up-dates";
import { db } from "@/lib/db";
import { formatDate, isoDate } from "@/lib/format";
import { localizedName } from "@/lib/localized-name";
import { reportTranslators } from "@/lib/messages";
import { accessScope, ALL_BRANCHES } from "@/lib/permissions";
import {
  chosenSort,
  mainTable,
  parseFilters,
  REPORT_CODES,
  reportRange,
  sortRows,
  type ReportCode,
  type ReportDef,
  type ReportFilters,
  type ReportResult,
  type RunContext,
} from "@/lib/reports/core";
import { REPORTS } from "@/lib/reports/definitions";
import { staffBranchWhere } from "@/lib/staff-scope";

export function isReportCode(value: string): value is ReportCode {
  return (REPORT_CODES as readonly string[]).includes(value);
}

// The reports this person may open: a salesperson R2 and R3 for themselves (M13.03), a
// manager R1–R8, an admin all nine.
export function reportsFor(user: SessionUser): ReportDef[] {
  return REPORT_CODES.map((code) => REPORTS[code]).filter((def) => def.roles.includes(user.role));
}

export function canExport(user: SessionUser): boolean {
  return user.role !== "SALESPERSON";
}

export type RanReport = {
  def: ReportDef;
  ctx: RunContext;
  result: ReportResult;
  sort: { key: string; dir: "asc" | "desc" };
};

// Runs the report and sorts its main table. Null when this person may not open it.
export async function runReport(
  user: SessionUser,
  code: string,
  params: Record<string, string | string[] | undefined>,
  locale: Locale,
): Promise<RanReport | null> {
  if (!isReportCode(code)) return null;
  const def = REPORTS[code];
  if (!def.roles.includes(user.role)) return null;

  const filters = parseFilters(params);
  const today = isoDate(new Date());
  const self = user.role === "SALESPERSON" ? user.id : null;
  const ctx: RunContext = {
    // A salesperson's own figures come from every branch they work in; everyone else
    // sees the branches in the switcher, like every other screen.
    scope: self ? accessScope(user) : await getBranchScope(user),
    range: reportRange(filters, today),
    today,
    filters,
    self,
    locale,
  };
  const result = await def.run(ctx);
  const table = mainTable(result);
  const sort = chosenSort(def, table, filters);
  if (table) table.rows = sortRows(table.rows, sort.key, sort.dir, locale);
  return { def, ctx, result, sort };
}

export type FilterOptions = {
  salespeople: { value: string; label: string }[];
  departments: { value: string; label: string }[];
  reasons: { value: string; label: string }[];
};

// Choices for the filter selects: staff of these branches (leavers too, so last year's
// figures can still be picked out), active departments, every reason.
export async function filterOptions(ran: RanReport): Promise<FilterOptions> {
  const wants = new Set(ran.def.filters);
  const [staff, departments, reasons] = await Promise.all([
    wants.has("salesperson") && !ran.ctx.self
      ? db.user.findMany({
          where: { ...staffBranchWhere(ran.ctx.scope), role: { in: ["SALESPERSON", "MANAGER"] } },
          select: { id: true, fullName: true },
          orderBy: { fullName: "asc" },
        })
      : [],
    wants.has("department")
      ? db.department.findMany({
          where: { status: "ACTIVE" },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
    wants.has("reason")
      ? db.lostReason.findMany({
          select: { id: true, nameEn: true, nameHi: true, nameGu: true },
          orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
        })
      : [],
  ]);
  return {
    salespeople: staff.map((person) => ({ value: person.id, label: person.fullName })),
    departments: departments.map((d) => ({ value: d.id, label: d.name })),
    reasons: reasons.map((r) => ({ value: r.id, label: localizedName(r, ran.ctx.locale) })),
  };
}

// "Period: 1 Sep 2026 – 24 Sep 2026", "Branch: Main", "Salesperson: Amit" … for the top
// of an export (M13: "the filters used").
export async function filterLines(user: SessionUser, ran: RanReport): Promise<string[]> {
  const { t } = await reportTranslators(ran.ctx.locale);
  const { ctx, def } = ran;
  const day = (value: string) => formatDate(dayForDisplay(value), ctx.locale);
  const lines: string[] = [];
  if (def.dateRange) {
    lines.push(t("filterLine.period", { from: day(ctx.range.from), to: day(ctx.range.to) }));
  }
  const choice = await getCurrentBranch(user);
  lines.push(
    t("filterLine.branch", {
      branch:
        ctx.self || choice === ALL_BRANCHES
          ? t("allBranches")
          : ((await getCurrentBranchName(choice)) ?? ""),
    }),
  );
  const options = await filterOptions(ran);
  const f: ReportFilters = ctx.filters;
  const name = (list: { value: string; label: string }[], value?: string) =>
    list.find((option) => option.value === value)?.label ?? value ?? "";
  if (ctx.self) lines.push(t("filterLine.ownOnly"));
  if (f.salesperson && !ctx.self)
    lines.push(t("filterLine.salesperson", { name: name(options.salespeople, f.salesperson) }));
  if (f.department)
    lines.push(t("filterLine.department", { name: name(options.departments, f.department) }));
  if (f.visitType)
    lines.push(t("filterLine.value", { value: t(`enums.visitType.${f.visitType}`) }));
  if (f.outcome) lines.push(t("filterLine.value", { value: t(`enums.outcome.${f.outcome}`) }));
  if (f.status) lines.push(t("filterLine.value", { value: t(`enums.status.${f.status}`) }));
  if (f.fromFollowUp)
    lines.push(
      t(f.fromFollowUp === "yes" ? "filterLine.fromFollowUpYes" : "filterLine.fromFollowUpNo"),
    );
  if (f.cancelled) lines.push(t("filterLine.withCancelled"));
  if (f.reason) lines.push(t("filterLine.reason", { name: name(options.reasons, f.reason) }));
  if (f.mobile) lines.push(t("filterLine.mobile", { mobile: f.mobile }));
  return lines;
}
