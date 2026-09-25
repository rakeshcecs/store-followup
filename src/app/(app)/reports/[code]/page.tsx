import { ArrowDown, ArrowUp, FileSpreadsheet, FileText } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/app/(app)/reports/[code]/print-button";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { mainTable, pageOf, type FilterKey, type ReportTable } from "@/lib/reports/core";
import { formatCell, isNumeric } from "@/lib/reports/format-cell";
import {
  canExport,
  filterOptions,
  runReport,
  type FilterOptions,
  type RanReport,
} from "@/lib/reports/run";
import { cn } from "@/lib/utils";

type Params = Record<string, string | string[] | undefined>;

// M13: one report — filters, a table that sorts by any column and pages 50 rows at a
// time with a totals row, and the Excel / PDF buttons for managers and admins.
//
// Everything is in the address (a GET form and plain links), so a filtered, sorted page
// can be reloaded, shared or opened in a new tab, and works without JavaScript.
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Params>;
}) {
  const user = await requireUser();
  const { code } = await params;
  const query = await searchParams;
  const locale = (await getLocale()) as Locale;
  const ran = await runReport(user, code, query, locale);
  if (!ran) notFound();

  const t = await getTranslations("reports");
  const options = await filterOptions(ran);
  const main = mainTable(ran.result);
  const paged = main ? pageOf(main.rows, ran.ctx.filters.page) : null;

  // The same address with some parameters changed (sorting and paging keep the filters).
  const href = (change: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first) next.set(key, first);
    }
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    const text = next.toString();
    return text ? `?${text}` : "?";
  };
  const exportHref = (format: "xlsx" | "pdf") =>
    `/reports/${code}/export${href({ page: undefined, format })}`;

  return (
    <AppShell
      role={user.role}
      title={t(`names.${ran.def.code}`)}
      backHref="/reports"
      backLabel={t("back")}
    >
      {ran.ctx.self && <p className="text-muted-foreground">{t("ownOnly")}</p>}

      <Filters ran={ran} options={options} />

      {canExport(user) && ran.result.tables.length > 0 && (
        <div className="flex flex-wrap gap-2.5 print:hidden">
          <Button asChild variant="secondary" className="grow">
            <a href={exportHref("xlsx")} download>
              <FileSpreadsheet aria-hidden />
              {t("excel")}
            </a>
          </Button>
          <Button asChild variant="secondary" className="grow">
            <a href={exportHref("pdf")} download>
              <FileText aria-hidden />
              {t("pdf")}
            </a>
          </Button>
          {ran.def.code === "r8" && <PrintButton label={t("print")} />}
        </div>
      )}

      {ran.result.empty && <Card className="p-4 text-muted-foreground">{ran.result.empty}</Card>}

      {ran.result.chart && ran.result.chart.length > 0 && <Chart ran={ran} />}

      {ran.result.tables.map((table) => {
        const isMain = table === main;
        const rows = isMain && paged ? paged.rows : table.rows;
        return (
          <section key={table.key} className="flex flex-col gap-2.5">
            {table.title && <h2 className="font-heading-style text-lg">{table.title}</h2>}
            {isMain && (
              <p className="text-sm text-muted-foreground" data-testid="row-count">
                {t("rows", { count: table.rows.length })}
              </p>
            )}
            {table.rows.length === 0 ? (
              <Card className="p-4 text-muted-foreground">{t("empty")}</Card>
            ) : (
              <DataTable
                table={table}
                rows={rows}
                locale={locale}
                sort={isMain ? ran.sort : null}
                sortHref={(key) =>
                  href({
                    sort: key,
                    dir: ran.sort.key === key && ran.sort.dir === "asc" ? "desc" : "asc",
                    page: undefined,
                  })
                }
                sortLabel={(column) => t("sortBy", { column })}
              />
            )}
            {isMain && paged && paged.pages > 1 && (
              <nav className="flex items-center justify-between gap-3 print:hidden">
                {paged.page > 1 ? (
                  <Link href={href({ page: paged.page - 1 })} className="font-bold text-primary">
                    {t("previous")}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm text-muted-foreground" data-testid="page-of">
                  {t("page", { page: paged.page, pages: paged.pages })}
                </span>
                {paged.page < paged.pages ? (
                  <Link href={href({ page: paged.page + 1 })} className="font-bold text-primary">
                    {t("next")}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </section>
        );
      })}
    </AppShell>
  );
}

// Visit types, outcomes and follow-up states, in the order the filters offer them.
const VISIT_TYPES = ["NEW", "EXISTING"] as const;
const OUTCOMES = ["PURCHASED", "DECIDE_LATER", "NOT_INTERESTED"] as const;
const STATUSES = ["pending", "overdue", "done", "rescheduled", "cancelled"] as const;
const YES_NO = ["yes", "no"] as const;

type SelectSpec = { key: FilterKey; list: { value: string; label: string }[]; value?: string };

async function Filters({ ran, options }: { ran: RanReport; options: FilterOptions }) {
  const t = await getTranslations("reports");
  const f = ran.ctx.filters;
  const any = { value: "", label: t("filters.any") };
  const wants = new Set<FilterKey>(ran.def.filters);
  if (ran.ctx.self) wants.delete("salesperson");

  // Each select this report has, built here rather than inline so the markup below stays
  // free of the values it submits.
  const allSelects: SelectSpec[] = [
    { key: "salesperson", list: options.salespeople, value: f.salesperson },
    { key: "department", list: options.departments, value: f.department },
    {
      key: "visitType",
      list: VISIT_TYPES.map((value) => ({ value, label: t(`enums.visitType.${value}`) })),
      value: f.visitType,
    },
    {
      key: "outcome",
      list: OUTCOMES.map((value) => ({ value, label: t(`enums.outcome.${value}`) })),
      value: f.outcome,
    },
    {
      key: "status",
      list: STATUSES.map((value) => ({ value, label: t(`enums.status.${value}`) })),
      value: f.status,
    },
    {
      key: "fromFollowUp",
      list: YES_NO.map((value) => ({ value, label: t(value) })),
      value: f.fromFollowUp,
    },
    { key: "reason", list: options.reasons, value: f.reason },
  ];
  const selects = allSelects.filter((select) => wants.has(select.key));
  const hasMobile = wants.has("mobile");
  const hasCancelled = wants.has("cancelled");

  return (
    <form method="get" className="flex flex-col gap-3 print:hidden" data-testid="report-filters">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {ran.def.dateRange && (
          <>
            <TextInput
              type="date"
              name="from"
              label={t("filters.from")}
              defaultValue={ran.ctx.range.from}
            />
            <TextInput
              type="date"
              name="to"
              label={t("filters.to")}
              defaultValue={ran.ctx.range.to}
            />
          </>
        )}
        {selects.map((select) => (
          <Select
            key={select.key}
            name={select.key}
            label={t(`filters.${select.key}`)}
            options={[any, ...select.list]}
            defaultValue={select.value ?? ""}
          />
        ))}
        {hasMobile && (
          <TextInput
            type="tel"
            inputMode="numeric"
            name="mobile"
            label={t("filters.mobile")}
            defaultValue={f.mobile ?? ""}
            className="col-span-2"
          />
        )}
      </div>
      {hasCancelled && (
        <label className="flex items-center gap-3 text-[15px] font-bold">
          <input
            type="checkbox"
            name="cancelled"
            value="yes"
            defaultChecked={f.cancelled === "yes"}
            className="size-5 accent-primary"
          />
          {t("filters.cancelled")}
        </label>
      )}
      <Button type="submit">{t("filters.show")}</Button>
    </form>
  );
}

const alignOf = (column: ReportTable["columns"][number]) =>
  isNumeric(column) ? "text-right" : "text-left";

function DataTable({
  table,
  rows,
  locale,
  sort,
  sortHref,
  sortLabel,
}: {
  table: ReportTable;
  rows: ReportTable["rows"];
  locale: Locale;
  sort: { key: string; dir: "asc" | "desc" } | null;
  sortHref: (key: string) => string;
  sortLabel: (column: string) => string;
}) {
  const head = "px-3 py-2.5 text-[13px] font-bold whitespace-nowrap text-muted-foreground";
  const cell = "px-3 py-2.5 align-top";
  return (
    <Card className="shrink-0 overflow-x-auto p-0">
      <table className="w-full text-[14px]" data-testid={`table-${table.key}`}>
        <thead className="border-b border-border">
          <tr>
            {table.columns.map((column) => {
              const align = alignOf(column);
              if (!sort) {
                return (
                  <th key={column.key} className={cn(head, align)}>
                    {column.label}
                  </th>
                );
              }
              const active = sort.key === column.key;
              return (
                <th
                  key={column.key}
                  className={cn(head, align)}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <Link
                    href={sortHref(column.key)}
                    aria-label={sortLabel(column.label)}
                    className={cn("inline-flex items-center gap-1", active && "text-foreground")}
                  >
                    {column.label}
                    {active &&
                      (sort.dir === "asc" ? (
                        <ArrowUp aria-hidden className="size-3.5" />
                      ) : (
                        <ArrowDown aria-hidden className="size-3.5" />
                      ))}
                  </Link>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className="border-b border-border last:border-0"
              data-testid="report-row"
            >
              {table.columns.map((column, i) => {
                const text = formatCell(column, row.cells[column.key] ?? null, locale);
                return (
                  <td
                    key={column.key}
                    className={cn(
                      cell,
                      isNumeric(column) && "text-right tabular-nums",
                      i === 0 && "whitespace-nowrap",
                    )}
                  >
                    {i === 1 && row.href ? (
                      <Link href={row.href} className="font-bold text-primary">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {table.totals && (
            <tr className="border-t-2 border-foreground font-extrabold" data-testid="totals-row">
              {table.columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(cell, isNumeric(column) && "text-right tabular-nums")}
                >
                  {formatCell(column, table.totals?.[column.key] ?? null, locale)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

// R6: new and existing customers per day, as bars.
async function Chart({ ran }: { ran: RanReport }) {
  const t = await getTranslations("reports");
  const bars = ran.result.chart ?? [];
  const max = Math.max(1, ...bars.map((bar) => bar.values.reduce((sum, v) => sum + v.value, 0)));
  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="chart">
      <h2 className="font-heading-style text-lg">{t("chart")}</h2>
      <div className="flex gap-4 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-primary" />
          {t("columns.new")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-primary/35" />
          {t("columns.existing")}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {bars.map((bar) => {
          const [fresh, existing] = bar.values;
          return (
            <li
              key={bar.label}
              className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-[13px]"
            >
              <span className="truncate text-muted-foreground">{bar.label}</span>
              <span className="flex h-3.5 overflow-hidden rounded-sm bg-surface-disabled">
                <span
                  className="bg-primary"
                  style={{ width: `${((fresh?.value ?? 0) / max) * 100}%` }}
                />
                <span
                  className="bg-primary/35"
                  style={{ width: `${((existing?.value ?? 0) / max) * 100}%` }}
                />
              </span>
              <span className="text-right tabular-nums">
                {(fresh?.value ?? 0) + (existing?.value ?? 0)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
