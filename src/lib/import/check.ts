// M24: checking every row of an uploaded file before anything is saved — the preview's
// Ready / Has mistakes / Already exists. Pure: the database lookups come in as maps, so
// the rules are unit-tested without a database (src/lib/import/prepare.ts loads them).
import { normalizeMobile } from "@/lib/mobile";
import type { Cell, SheetRow } from "@/lib/import/read";
import type { ImportColumn, ImportRow, Message } from "@/lib/import/types";

export type CheckContext = {
  uploaderId: string;
  // Active salespeople and managers of the branch, by their own mobile.
  staffByMobile: Map<string, string>;
  // Active departments by lower-case name.
  departments: Map<string, string>;
  // Existing customers by main and alternate number.
  existing: Map<string, string>;
};

// SOW 5.3 lengths, the same as the customer form (src/lib/validation/customer.ts).
const MAX = { name: 100, area: 60, city: 60, occasion: 100 } as const;

const YES = new Set(["yes", "y", "true", "1", "हाँ", "हां", "હા"]);
const NO = new Set(["no", "n", "false", "0", "नहीं", "नही", "ના"]);

const text = (cell: Cell | undefined): string | null =>
  cell === null || cell === undefined
    ? null
    : cell instanceof Date
      ? cell.toISOString().slice(0, 10)
      : cell.trim() || null;

// A real calendar day as "YYYY-MM-DD", from an Excel date cell or "DD-MM-YYYY" (also with
// slashes or dots), or the ISO form. Null when it is not one.
export function importDate(cell: Cell | undefined): string | null | "invalid" {
  if (cell === null || cell === undefined || cell === "") return null;
  let y: number, m: number, d: number;
  if (cell instanceof Date) {
    // Excel stores a date as midnight UTC of that day.
    y = cell.getUTCFullYear();
    m = cell.getUTCMonth() + 1;
    d = cell.getUTCDate();
  } else {
    const dmy = cell.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    const ymd = cell.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    else if (ymd) [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
    else return "invalid";
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return "invalid";
  if (y < 1900 || y > 2100) return "invalid";
  return date.toISOString().slice(0, 10);
}

export function checkRows(
  rows: SheetRow[],
  columns: Partial<Record<ImportColumn, number>>,
  ctx: CheckContext,
): ImportRow[] {
  const seen = new Map<string, number>(); // number → the file row that had it first
  const get = (row: SheetRow, column: ImportColumn) =>
    columns[column] === undefined ? null : (row.cells[columns[column]!] ?? null);

  return rows.map((row) => {
    const errors: Message[] = [];
    const notes: Message[] = [];
    const err = (key: string, values?: Message["values"]) =>
      errors.push({ key: `import.rowErrors.${key}`, ...(values ? { values } : {}) });

    const name = text(get(row, "name")) ?? "";
    if (!name) err("nameRequired");
    else if (name.length > MAX.name) err("nameTooLong", { max: MAX.name });

    const typedMobile = text(get(row, "mobile")) ?? "";
    const mobile = normalizeMobile(typedMobile);
    if (!typedMobile) err("mobileRequired");
    else if (!mobile) err("mobileInvalid");

    const typedAlt = text(get(row, "altMobile"));
    const altMobile = typedAlt ? normalizeMobile(typedAlt) : null;
    if (typedAlt && !altMobile) err("altInvalid");
    else if (altMobile && altMobile === mobile) err("altSame");

    const limited = (column: "area" | "city" | "occasion") => {
      const value = text(get(row, column));
      if (value && value.length > MAX[column]) err(`${column}TooLong`, { max: MAX[column] });
      return value;
    };
    const area = limited("area");
    const city = limited("city");
    const occasion = limited("occasion");

    const date = importDate(get(row, "occasionDate"));
    if (date === "invalid") err("dateInvalid");

    const consent = (text(get(row, "whatsapp")) ?? "").toLowerCase();
    if (consent && !YES.has(consent) && !NO.has(consent)) err("whatsappInvalid");

    const departmentName = text(get(row, "department"));
    const departmentId = departmentName
      ? (ctx.departments.get(departmentName.toLowerCase()) ?? null)
      : null;
    if (departmentName && !departmentId)
      notes.push({ key: "import.notes.departmentUnknown", values: { name: departmentName } });

    // Unknown salesperson → the person uploading (module prompt), and the file says so.
    const typedSeller = text(get(row, "salespersonMobile"));
    const sellerMobile = typedSeller ? normalizeMobile(typedSeller) : null;
    const seller = sellerMobile ? ctx.staffByMobile.get(sellerMobile) : undefined;
    if (typedSeller && !seller)
      notes.push({ key: "import.notes.salespersonUnknown", values: { mobile: typedSeller } });

    // The same person twice in one file: the first row counts, the next is a mistake.
    for (const number of [mobile, altMobile]) {
      if (!number) continue;
      const first = seen.get(number);
      if (first !== undefined) {
        err("duplicateInFile", { line: first });
        break;
      }
    }
    if (errors.length === 0) {
      if (mobile) seen.set(mobile, row.line);
      if (altMobile) seen.set(altMobile, row.line);
    }

    const existingId = mobile ? (ctx.existing.get(mobile) ?? null) : null;
    // An alternate that is some other customer's number would make search find two people.
    const altOwner = altMobile ? ctx.existing.get(altMobile) : undefined;
    if (errors.length === 0 && altOwner && altOwner !== existingId) err("altTaken");

    return {
      line: row.line,
      state: errors.length > 0 ? "error" : existingId ? "exists" : "ready",
      name,
      mobile: mobile ?? typedMobile,
      altMobile,
      area,
      city,
      departmentId,
      occasion,
      occasionDate: date === "invalid" ? null : date,
      assignedToId: seller ?? ctx.uploaderId,
      whatsapp: YES.has(consent),
      existingId,
      errors,
      notes,
    };
  });
}

// The numbers a file mentions, for loading the lookups in one go.
export function numbersIn(
  rows: SheetRow[],
  columns: Partial<Record<ImportColumn, number>>,
): { customers: string[]; staff: string[] } {
  const pick = (column: ImportColumn) =>
    columns[column] === undefined
      ? []
      : rows.flatMap((row) => {
          const n = normalizeMobile(text(row.cells[columns[column]!] ?? null) ?? "");
          return n ? [n] : [];
        });
  return {
    customers: [...new Set([...pick("mobile"), ...pick("altMobile")])],
    staff: [...new Set(pick("salespersonMobile"))],
  };
}
