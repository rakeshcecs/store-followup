// M24 customer import: the shape of one checked row, stored on the ImportJob between the
// preview and the worker. Messages are next-intl keys with values, never text, so the
// preview and the result file read in whoever opens them's language.

// The template's columns, in order (M24 module prompt).
export const IMPORT_COLUMNS = [
  "name",
  "mobile",
  "altMobile",
  "area",
  "city",
  "department",
  "occasion",
  "occasionDate",
  "salespersonMobile",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export const REQUIRED_COLUMNS: ImportColumn[] = ["name", "mobile"];

export const IMPORT_MAX_ROWS = 20_000;
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024; // under the proxy's 10 MB body buffer
export const IMPORT_CHUNK = 500;

export type Message = { key: string; values?: Record<string, string | number> };

export type RowState = "ready" | "error" | "exists";

export type ImportRow = {
  line: number; // the row number in the file, as Excel shows it
  state: RowState;
  name: string;
  mobile: string; // normalised when valid, as typed otherwise
  altMobile: string | null;
  area: string | null;
  city: string | null;
  departmentId: string | null;
  occasion: string | null;
  occasionDate: string | null; // "YYYY-MM-DD"
  assignedToId: string;
  existingId: string | null; // the customer this number already belongs to
  errors: Message[];
  notes: Message[]; // imported anyway, but worth saying (unknown salesperson…)
};

// What happened to a row that was not simply imported, for the result file.
export type Outcome = {
  line: number;
  name: string;
  mobile: string;
  result: "imported" | "updated" | "skipped";
  reasons: Message[];
};
