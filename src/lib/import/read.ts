// M24: reading an uploaded .xlsx or .csv into plain rows, and finding the template's
// columns by their headings. The headings may be in English, Hindi or Gujarati — the
// template is downloaded in the reader's language — and in any order.
import ExcelJS from "exceljs";
import en from "../../../messages/en.json";
import gu from "../../../messages/gu.json";
import hi from "../../../messages/hi.json";
import { IMPORT_COLUMNS, type ImportColumn } from "@/lib/import/types";

export type Cell = string | Date | null;
export type SheetRow = { line: number; cells: Cell[] };
export type ReadResult =
  | { ok: true; columns: Partial<Record<ImportColumn, number>>; rows: SheetRow[] }
  | { ok: false; error: string };

// "Occasion date (DD-MM-YYYY)" → "occasiondate"; "नाम*" → "नाम".
export function headingKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[\s*_\-./:]+/g, "")
    .trim();
}

const HEADINGS = new Map<string, ImportColumn>();
for (const messages of [en, hi, gu]) {
  for (const column of IMPORT_COLUMNS) {
    HEADINGS.set(headingKey(messages.import.columns[column]), column);
  }
}

// What a cell holds, as text or a date. Excel keeps a typed mobile as a number, a date as
// a Date, and formulas, links and formatted text as objects.
export function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "string" || typeof value === "boolean") return String(value).trim() || null;
  if (typeof value === "object") {
    if ("richText" in value)
      return (
        value.richText
          .map((part) => part.text)
          .join("")
          .trim() || null
      );
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim() || null;
  }
  return null;
}

// RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes. Excel in
// some regions saves with semicolons, so the separator is whichever the heading uses.
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, ""); // Excel's "CSV UTF-8" starts with a BOM
  const firstLine = body.slice(0, body.indexOf("\n") === -1 ? undefined : body.indexOf("\n"));
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function mapColumns(heading: Cell[]): Partial<Record<ImportColumn, number>> {
  const columns: Partial<Record<ImportColumn, number>> = {};
  heading.forEach((cell, index) => {
    const column = typeof cell === "string" ? HEADINGS.get(headingKey(cell)) : undefined;
    if (column && columns[column] === undefined) columns[column] = index;
  });
  return columns;
}

const blank = (cells: Cell[]) => cells.every((cell) => cell === null || cell === "");

export async function readImportFile(bytes: ArrayBuffer, fileName: string): Promise<ReadResult> {
  const name = fileName.toLowerCase();
  let table: SheetRow[] = [];
  if (name.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(bytes);
    table = parseCsv(text).map((cells, i) => ({
      line: i + 1,
      cells: cells.map((cell) => cell.trim() || null),
    }));
  } else if (name.endsWith(".xlsx")) {
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(bytes);
    } catch {
      return { ok: false, error: "import.errors.unreadable" };
    }
    const sheet = book.worksheets[0];
    if (!sheet) return { ok: false, error: "import.errors.empty" };
    sheet.eachRow({ includeEmpty: false }, (row, line) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1);
      table.push({ line, cells: values.map(cellValue) });
    });
  } else {
    return { ok: false, error: "import.errors.fileType" };
  }

  const headerIndex = table.findIndex((row) => !blank(row.cells));
  if (headerIndex === -1) return { ok: false, error: "import.errors.empty" };
  const columns = mapColumns(table[headerIndex]!.cells);
  if (columns.name === undefined || columns.mobile === undefined) {
    return { ok: false, error: "import.errors.headings" };
  }
  const rows = table.slice(headerIndex + 1).filter((row) => !blank(row.cells));
  if (rows.length === 0) return { ok: false, error: "import.errors.empty" };
  return { ok: true, columns, rows };
}
