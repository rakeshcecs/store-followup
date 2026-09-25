// M13: what every report shares — the table shape the screen, the Excel file and the PDF
// all draw from, the filters read from the address, and sorting and paging.
//
// A report returns its rows already in the reader's language (enum labels translated,
// names resolved), with raw values where a spreadsheet needs them: a day is
// "YYYY-MM-DD", a number is a number. Sorting then works on those values.
import { z } from "zod";
import { isRealDay } from "@/lib/validation/common";
import type { Role } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";
import { CUSTOM_MAX_DAYS, type DayRange } from "@/lib/dashboard-period";
import { daysBetween } from "@/lib/follow-up-dates";
import { collator } from "@/lib/format";
import type { BranchScope } from "@/lib/permissions";

export const REPORT_CODES = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"] as const;
export type ReportCode = (typeof REPORT_CODES)[number];

export const PAGE_SIZE = 50;

export type ColumnKind = "text" | "day" | "datetime" | "number" | "percent" | "money" | "mobile";
export type Cell = string | number | null;
export type Column = { key: string; label: string; kind: ColumnKind };
export type Row = { cells: Record<string, Cell>; href?: string };

export type ReportTable = {
  key: string;
  title?: string;
  columns: Column[];
  rows: Row[];
  totals?: Record<string, Cell>;
  // The one table per report that sorts and pages (R7's detail, not its summary).
  main?: boolean;
};

export type ReportResult = {
  tables: ReportTable[];
  // R6's bar chart: one bar pair per row of the main table.
  chart?: { label: string; values: { key: string; label: string; value: number }[] }[];
  // R8: nothing to show until a customer is found.
  empty?: string;
};

export const FILTER_KEYS = [
  "salesperson",
  "department",
  "visitType",
  "outcome",
  "status",
  "fromFollowUp",
  "cancelled",
  "reason",
  "mobile",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const FOLLOW_UP_STATUSES = [
  "pending",
  "overdue",
  "done",
  "rescheduled",
  "cancelled",
] as const;

const id = z.string().trim().min(1).max(40);
const day = z.string().refine(isRealDay);
const filtersSchema = z.object({
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  salesperson: id.optional().catch(undefined),
  department: id.optional().catch(undefined),
  visitType: z.enum(["NEW", "EXISTING"]).optional().catch(undefined),
  outcome: z.enum(["PURCHASED", "DECIDE_LATER", "NOT_INTERESTED"]).optional().catch(undefined),
  status: z.enum(FOLLOW_UP_STATUSES).optional().catch(undefined),
  fromFollowUp: z.enum(["yes", "no"]).optional().catch(undefined),
  cancelled: z.enum(["yes"]).optional().catch(undefined),
  reason: id.optional().catch(undefined),
  mobile: z.string().trim().max(20).optional().catch(undefined),
  sort: z.string().max(40).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type ReportFilters = z.infer<typeof filtersSchema>;

// From the address bar. Empty strings (a select left on "Any") count as not set.
export function parseFilters(params: Record<string, string | string[] | undefined>): ReportFilters {
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") flat[key] = first;
  }
  return filtersSchema.parse(flat);
}

// The report's days: the chosen range, or this month so far. A range that is backwards
// or longer than a year falls back to this month too (M13.04 sizes reports for 12 months).
export function reportRange(filters: ReportFilters, today: string): DayRange {
  const { from, to } = filters;
  if (from && to && from <= to && daysBetween(from, to) < CUSTOM_MAX_DAYS) return { from, to };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

// Everything a report needs to run.
export type RunContext = {
  scope: BranchScope;
  range: DayRange;
  today: string;
  filters: ReportFilters;
  // A salesperson sees their own figures only (M13.03): their id, or null for managers.
  self: string | null;
  locale: Locale;
};

export type ReportDef = {
  code: ReportCode;
  roles: Role[];
  dateRange: boolean;
  filters: FilterKey[];
  defaultSort: { key: string; dir: "asc" | "desc" };
  run: (ctx: RunContext) => Promise<ReportResult>;
};

export function mainTable(result: ReportResult): ReportTable | undefined {
  return result.tables.find((table) => table.main) ?? result.tables[0];
}

// Sorts on the raw values; empty cells last whichever way.
export function sortRows(rows: Row[], key: string, dir: "asc" | "desc", locale: Locale): Row[] {
  const compare = collator(locale);
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a.cells[key] ?? null;
    const y = b.cells[key] ?? null;
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return compare.compare(String(x), String(y)) * sign;
  });
}

// The sort the reader asked for when the report has that column, else the report's own.
export function chosenSort(
  def: ReportDef,
  table: ReportTable | undefined,
  filters: ReportFilters,
): { key: string; dir: "asc" | "desc" } {
  const known = table?.columns.some((column) => column.key === filters.sort);
  return known && filters.sort ? { key: filters.sort, dir: filters.dir ?? "asc" } : def.defaultSort;
}

export function pageOf<T>(rows: T[], page: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  return { rows: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages };
}
