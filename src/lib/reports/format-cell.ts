// A report cell as the reader sees it, on screen and in the PDF: days and times in their
// language, Indian number grouping, rupees, a formatted mobile. Excel gets the raw values
// instead (src/lib/reports/xlsx.ts).
import type { Locale } from "@/i18n/config";
import { dayForDisplay } from "@/lib/follow-up-dates";
import { formatDate, formatDateTime, formatMobile, formatMoney, formatNumber } from "@/lib/format";
import type { Cell, Column } from "@/lib/reports/core";

// A date column also holds the word "Total" on the totals row.
export const isDayValue = (value: Cell) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
export const isInstantValue = (value: Cell) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value);

export function formatCell(column: Column, value: Cell, locale: Locale): string {
  if (value === null || value === "") return "";
  if (column.kind === "day" && !isDayValue(value)) return String(value);
  if (column.kind === "datetime" && !isInstantValue(value)) return String(value);
  switch (column.kind) {
    case "day":
      return formatDate(dayForDisplay(String(value)), locale);
    case "datetime":
      return formatDateTime(String(value), locale);
    case "number":
      return typeof value === "number" ? formatNumber(value, locale) : String(value);
    case "percent":
      return typeof value === "number" ? `${formatNumber(value, locale)}%` : String(value);
    case "money":
      return typeof value === "number" ? formatMoney(value, locale) : String(value);
    case "mobile":
      return formatMobile(String(value));
    default:
      return String(value);
  }
}

export const isNumeric = (column: Column) =>
  column.kind === "number" || column.kind === "percent" || column.kind === "money";
