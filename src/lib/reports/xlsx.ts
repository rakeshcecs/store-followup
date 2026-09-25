// M13 "Export to Excel": one sheet per table, with the store, the report, the filters and
// the time on top. Cells carry real types — a day is an Excel date, an amount a number —
// so sorting and adding up work in Excel and Google Sheets.
import ExcelJS from "exceljs";
import type { Cell, Column, ReportResult, ReportTable } from "@/lib/reports/core";
import { isDayValue, isInstantValue } from "@/lib/reports/format-cell";

export type ExportMeta = {
  storeName: string;
  title: string;
  lines: string[]; // the filters used
  exportedAt: string; // already formatted in the reader's language
};

const IST_MS = (5 * 60 + 30) * 60 * 1000;

// Excel has no time zones: a date cell is a wall-clock reading. Days are stored as UTC
// midnight; an instant is shifted to what an Indian clock showed.
function excelValue(column: Column, value: Cell): ExcelJS.CellValue {
  if (value === null || value === "") return null;
  // The totals row's "Total" sits in a date column.
  if (column.kind === "day" && !isDayValue(value)) return String(value);
  if (column.kind === "datetime" && !isInstantValue(value)) return String(value);
  if (
    (column.kind === "number" || column.kind === "money" || column.kind === "percent") &&
    typeof value !== "number"
  ) {
    return String(value);
  }
  switch (column.kind) {
    case "day":
      return new Date(`${value}T00:00:00.000Z`);
    case "datetime":
      return new Date(new Date(String(value)).getTime() + IST_MS);
    case "percent":
      return Number(value) / 100;
    case "number":
    case "money":
      return Number(value);
    default:
      return String(value);
  }
}

const FORMAT: Partial<Record<Column["kind"], string>> = {
  day: "dd-mmm-yyyy",
  datetime: "dd-mmm-yyyy hh:mm",
  percent: "0%",
  money: "#,##0.00",
  number: "0",
};

// Sheet names: at most 31 characters and none of : \ / ? * [ ].
function sheetName(name: string, used: Set<string>): string {
  const base =
    name
      .replace(/[:\\/?*[\]]/g, " ")
      .slice(0, 28)
      .trim() || "Sheet";
  let candidate = base;
  for (let n = 2; used.has(candidate); n += 1) candidate = `${base} ${n}`;
  used.add(candidate);
  return candidate;
}

function addTable(book: ExcelJS.Workbook, meta: ExportMeta, table: ReportTable, used: Set<string>) {
  const sheet = book.addWorksheet(sheetName(table.title ?? meta.title, used));
  sheet.addRow([meta.storeName]).font = { bold: true, size: 14 };
  sheet.addRow([table.title ? `${meta.title} · ${table.title}` : meta.title]).font = {
    bold: true,
    size: 12,
  };
  for (const line of meta.lines) sheet.addRow([line]);
  sheet.addRow([meta.exportedAt]);
  sheet.addRow([]);

  const header = sheet.addRow(table.columns.map((column) => column.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } };
    cell.border = { bottom: { style: "thin" } };
  });
  // Filters and sorting in Excel work on the header row straight away.
  sheet.autoFilter = {
    from: { row: header.number, column: 1 },
    to: { row: header.number, column: table.columns.length },
  };
  sheet.views = [{ state: "frozen", ySplit: header.number }];

  const put = (values: Record<string, Cell>, bold = false) => {
    const row = sheet.addRow(
      table.columns.map((column) => excelValue(column, values[column.key] ?? null)),
    );
    table.columns.forEach((column, i) => {
      const format = FORMAT[column.kind];
      if (format) row.getCell(i + 1).numFmt = format;
    });
    if (bold) row.font = { bold: true };
  };
  for (const row of table.rows) put(row.cells);
  if (table.totals) put(table.totals, true);

  table.columns.forEach((column, i) => {
    const longest = Math.max(
      column.label.length,
      ...table.rows.slice(0, 500).map((row) => String(row.cells[column.key] ?? "").length),
    );
    sheet.getColumn(i + 1).width = Math.min(48, Math.max(10, longest + 2));
  });
}

export async function toXlsx(meta: ExportMeta, result: ReportResult): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = meta.storeName;
  const used = new Set<string>();
  for (const table of result.tables) addTable(book, meta, table, used);
  if (result.tables.length === 0)
    book.addWorksheet(sheetName(meta.title, used)).addRow([meta.title]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
