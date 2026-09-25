import ExcelJS from "exceljs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import gu from "../../messages/gu.json";
import hi from "../../messages/hi.json";
import { checkRows, importDate, numbersIn, type CheckContext } from "@/lib/import/check";
import { resultXlsx, templateXlsx } from "@/lib/import/files";
import { cellValue, headingKey, parseCsv, readImportFile, type SheetRow } from "@/lib/import/read";
import { IMPORT_COLUMNS, type ImportColumn } from "@/lib/import/types";

// M24: reading the file, finding the columns, and every row rule — without a database.

const COLUMNS = Object.fromEntries(IMPORT_COLUMNS.map((c, i) => [c, i])) as Record<
  ImportColumn,
  number
>;
let line = 1;
const row = (values: Partial<Record<ImportColumn, string | Date>>): SheetRow => ({
  line: ++line,
  cells: IMPORT_COLUMNS.map((c) => values[c] ?? null),
});
const ctx = (extra: Partial<CheckContext> = {}): CheckContext => ({
  uploaderId: "uploader",
  staffByMobile: new Map([["9800000001", "seller-1"]]),
  departments: new Map([["sarees", "dept-sarees"]]),
  existing: new Map([
    ["9811111111", "cust-1"],
    ["9822222222", "cust-2"],
  ]),
  ...extra,
});
const one = (values: Partial<Record<ImportColumn, string | Date>>, extra?: Partial<CheckContext>) =>
  checkRows([row(values)], COLUMNS, ctx(extra))[0]!;
const keys = (messages: { key: string }[]) => messages.map((m) => m.key.split(".").at(-1));

async function book(rows: (string | number | Date | null)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Customers");
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe("headings", () => {
  it("finds every column by its heading in English, Hindi and Gujarati", () => {
    for (const messages of [en, hi, gu]) {
      for (const column of IMPORT_COLUMNS) {
        expect(headingKey(messages.import.columns[column])).not.toBe("");
      }
    }
    expect(headingKey("Occasion date (DD-MM-YYYY)")).toBe("occasiondate");
    expect(headingKey(" Name* ")).toBe("name");
  });

  it("reads a Hindi template with the columns in another order", async () => {
    const heading = [hi.import.columns.mobile, hi.import.columns.name, hi.import.columns.city];
    const file = await book([heading, ["98250 12345", "राजेश पटेल", "सूरत"]]);
    const read = await readImportFile(file, "hindi.xlsx");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.columns).toMatchObject({ mobile: 0, name: 1, city: 2 });
    expect(read.rows[0]!.cells).toEqual(["98250 12345", "राजेश पटेल", "सूरत"]);
    expect(read.rows[0]!.line).toBe(2);
  });

  it("refuses a file without Name and Mobile headings, an empty one, and other types", async () => {
    expect(
      await readImportFile(
        await book([
          ["Foo", "Bar"],
          ["a", "b"],
        ]),
        "x.xlsx",
      ),
    ).toEqual({
      ok: false,
      error: "import.errors.headings",
    });
    expect(await readImportFile(await book([["Name*", "Mobile*"]]), "x.xlsx")).toEqual({
      ok: false,
      error: "import.errors.empty",
    });
    expect(await readImportFile(new ArrayBuffer(4), "x.pdf")).toEqual({
      ok: false,
      error: "import.errors.fileType",
    });
    expect(await readImportFile(new TextEncoder().encode("not a zip").buffer, "x.xlsx")).toEqual({
      ok: false,
      error: "import.errors.unreadable",
    });
  });

  it("skips blank rows and keeps Excel's row numbers", async () => {
    const file = await book([
      ["Name*", "Mobile*"],
      ["Asha", "9825012345"],
      [null, null],
      ["Bhavesh", 9825012346],
    ]);
    const read = await readImportFile(file, "gaps.xlsx");
    expect(read.ok && read.rows.map((r) => [r.line, r.cells[1]])).toEqual([
      [2, "9825012345"],
      [4, "9825012346"], // a number cell becomes the same digits
    ]);
  });
});

describe("cells and CSV", () => {
  it("turns Excel's cell kinds into text or a date", () => {
    const date = new Date("2026-12-05T00:00:00.000Z");
    expect(cellValue(9825012345)).toBe("9825012345");
    expect(cellValue(date)).toBe(date);
    expect(cellValue({ richText: [{ text: "Asha " }, { text: "Patel" }] })).toBe("Asha Patel");
    expect(cellValue({ formula: "A1", result: "x" } as ExcelJS.CellValue)).toBe("x");
    expect(cellValue("  ")).toBeNull();
    expect(cellValue(null)).toBeNull();
  });

  it("parses quotes, commas and line breaks inside quotes, a BOM and semicolons", () => {
    expect(parseCsv('﻿Name,Mobile\r\n"Patel, Asha",9825012345\n"Say ""hi""\nthere",1')).toEqual([
      ["Name", "Mobile"],
      ["Patel, Asha", "9825012345"],
      ['Say "hi"\nthere', "1"],
    ]);
    expect(parseCsv("Name;Mobile\nAsha;9825012345")).toEqual([
      ["Name", "Mobile"],
      ["Asha", "9825012345"],
    ]);
  });

  it("reads a CSV file the same way", async () => {
    const csv = "Name*,Mobile*,City\nAsha,+91 98250 12345,Surat\n";
    const read = await readImportFile(new TextEncoder().encode(csv).buffer as ArrayBuffer, "a.csv");
    expect(read.ok && read.rows[0]!.cells).toEqual(["Asha", "+91 98250 12345", "Surat"]);
  });
});

describe("occasion dates", () => {
  it("accepts DD-MM-YYYY, slashes, dots, ISO and Excel dates", () => {
    expect(importDate("05-12-2026")).toBe("2026-12-05");
    expect(importDate("5/1/2027")).toBe("2027-01-05");
    expect(importDate("05.12.2026")).toBe("2026-12-05");
    expect(importDate("2026-12-05")).toBe("2026-12-05");
    expect(importDate(new Date("2026-12-05T00:00:00.000Z"))).toBe("2026-12-05");
    expect(importDate(null)).toBeNull();
    expect(importDate("")).toBeNull();
  });

  it("refuses days that do not exist and anything else", () => {
    for (const bad of ["31-02-2026", "12-13-2026", "next week", "05-12-26", "01-01-1800"])
      expect(importDate(bad), bad).toBe("invalid");
  });
});

describe("row rules", () => {
  it("a good row is ready, with its fields normalised", () => {
    const r = one({
      name: "Asha Patel",
      mobile: "+91 98250-12345",
      altMobile: "098250 12346",
      area: "Adajan",
      city: "Surat",
      department: "SAREES",
      occasion: "Wedding",
      occasionDate: "05-12-2026",
      salespersonMobile: "9800000001",
    });
    expect(r).toMatchObject({
      state: "ready",
      name: "Asha Patel",
      mobile: "9825012345",
      altMobile: "9825012346",
      departmentId: "dept-sarees",
      occasionDate: "2026-12-05",
      assignedToId: "seller-1",
      errors: [],
      notes: [],
    });
  });

  it("names every mistake", () => {
    const r = one({
      name: "",
      mobile: "12345",
      altMobile: "abc",
      area: "x".repeat(61),
      city: "y".repeat(61),
      occasion: "z".repeat(101),
      occasionDate: "31-02-2026",
    });
    expect(r.state).toBe("error");
    expect(keys(r.errors)).toEqual([
      "nameRequired",
      "mobileInvalid",
      "altInvalid",
      "areaTooLong",
      "cityTooLong",
      "occasionTooLong",
      "dateInvalid",
    ]);
    expect(keys(one({ name: "A", mobile: "" }).errors)).toEqual(["mobileRequired"]);
    expect(keys(one({ name: "x".repeat(101), mobile: "9825012345" }).errors)).toEqual([
      "nameTooLong",
    ]);
    expect(keys(one({ name: "A", mobile: "9825012345", altMobile: "9825012345" }).errors)).toEqual([
      "altSame",
    ]);
  });

  it("an unknown salesperson or department is a note, and the uploader gets the customer", () => {
    const r = one({
      name: "A",
      mobile: "9825012345",
      salespersonMobile: "9899999999",
      department: "Shoes",
    });
    expect(r.state).toBe("ready");
    expect(r.assignedToId).toBe("uploader");
    expect(keys(r.notes)).toEqual(["departmentUnknown", "salespersonUnknown"]);
    expect(r.notes[1]!.values).toEqual({ mobile: "9899999999" });
    // Left empty: the uploader, and nothing to say.
    expect(one({ name: "A", mobile: "9825012345" })).toMatchObject({
      assignedToId: "uploader",
      notes: [],
    });
  });

  it("finds customers who already exist, by main or alternate number", () => {
    expect(one({ name: "A", mobile: "9811111111" })).toMatchObject({
      state: "exists",
      existingId: "cust-1",
    });
    const taken = one({ name: "A", mobile: "9825012345", altMobile: "9822222222" });
    expect(taken.state).toBe("error");
    expect(keys(taken.errors)).toEqual(["altTaken"]);
    // Their own alternate is fine.
    expect(
      one(
        { name: "A", mobile: "9811111111", altMobile: "9833333333" },
        {
          existing: new Map([
            ["9811111111", "cust-1"],
            ["9833333333", "cust-1"],
          ]),
        },
      ).state,
    ).toBe("exists");
  });

  it("the same number twice in one file: the first counts, the next is a mistake", () => {
    const rows = checkRows(
      [
        row({ name: "A", mobile: "9825012345" }),
        row({ name: "B", mobile: "98250 12345" }),
        row({ name: "C", mobile: "9825099999", altMobile: "9825012345" }),
        row({ name: "D", mobile: "9825088888" }),
      ],
      COLUMNS,
      ctx(),
    );
    expect(rows.map((r) => r.state)).toEqual(["ready", "error", "error", "ready"]);
    expect(rows[1]!.errors[0]).toMatchObject({ values: { line: rows[0]!.line } });
  });

  it("collects the numbers to look up", () => {
    const rows = [
      row({
        name: "A",
        mobile: "9825012345",
        altMobile: "9825012346",
        salespersonMobile: "9800000001",
      }),
      row({ name: "B", mobile: "bad" }),
    ];
    expect(numbersIn(rows, COLUMNS)).toEqual({
      customers: ["9825012345", "9825012346"],
      staff: ["9800000001"],
    });
  });
});

describe("files", () => {
  it("the template has the columns in the reader's language and reads back", async () => {
    for (const [locale, messages] of [
      ["en", en],
      ["gu", gu],
    ] as const) {
      const buf = await templateXlsx(locale, "Store");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const sheet = wb.worksheets[0]!;
      expect((sheet.getRow(1).values as string[]).slice(1)).toEqual(
        IMPORT_COLUMNS.map((c) => messages.import.columns[c]),
      );
      expect(sheet.getColumn(2).numFmt).toBe("@"); // mobiles stay text
      expect(wb.worksheets[1]!.getCell("A1").value).toBe(messages.import.template.helpTitle);
      // Fill one row and read it back as an upload.
      sheet.getRow(2).values = ["Asha", "9825012345"];
      const filled = await wb.xlsx.writeBuffer();
      const read = await readImportFile(filled as ArrayBuffer, "t.xlsx");
      expect(read.ok && read.rows.length).toBe(1);
    }
  });

  it("the result file lists each row with its outcome and reasons, sorted", async () => {
    const buf = await resultXlsx(
      "en",
      { storeName: "Store", fileName: "list.xlsx", lines: ["Branch: A"] },
      [
        {
          line: 7,
          name: "B",
          mobile: "123",
          result: "skipped",
          reasons: [{ key: "import.rowErrors.mobileInvalid" }],
        },
        {
          line: 3,
          name: "A",
          mobile: "9825012345",
          result: "imported",
          reasons: [{ key: "import.notes.salespersonUnknown", values: { mobile: "98" } }],
        },
      ],
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const rows = wb.worksheets[0]!.getSheetValues()
      .filter(Boolean)
      .map((r) => (r as unknown[]).slice(1));
    expect(rows[0]).toEqual(["Store"]);
    expect(rows[1]).toEqual(["Import result: list.xlsx"]);
    const data = rows.slice(-2);
    expect(data[0]).toEqual([
      3,
      "A",
      "9825012345",
      "Imported",
      "No salesperson with mobile 98 in this branch; assigned to the person importing",
    ]);
    expect(data[1]).toEqual([
      7,
      "B",
      "123",
      "Not imported",
      "Mobile must be 10 digits starting with 6, 7, 8 or 9",
    ]);
  });

  it("a clean import says so under the table instead of leaving it empty", async () => {
    const buf = await resultXlsx("en", { storeName: "Store", fileName: "l.xlsx", lines: [] }, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const rows = wb.worksheets[0]!.getSheetValues()
      .filter(Boolean)
      .map((r) => (r as unknown[]).slice(1));
    expect(rows.at(-1)).toEqual([en.import.result.nothingToList]);
  });

  it("the counts line says 1 row, not 1 rows", () => {
    const t = createTranslator({ locale: "en", messages: en, namespace: "import.result" });
    const counts = { imported: 1, updated: 0, skipped: 0 };
    expect(t("counts", { total: 1, ...counts })).toMatch(/^1 row:/);
    expect(t("counts", { total: 5, ...counts })).toMatch(/^5 rows:/);
  });
});
