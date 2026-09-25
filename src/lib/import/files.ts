// M24 files: the template to fill in (M24.01) and the result file listing every row that
// was not imported, or was imported with a note, and why (M24.05). Both in the reader's
// language; the template's headings are read back in any of the three (read.ts).
import ExcelJS from "exceljs";
import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/config";
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, type Outcome } from "@/lib/import/types";
import { formatNumber } from "@/lib/format";
import { loadMessages } from "@/lib/messages";

const DROPDOWN_ROWS = 2_000;
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } } as const;

// Every value in these columns is text, so Excel neither drops a leading zero nor turns
// "05-10-2026" into a number.
const TEXT_COLUMNS = new Set(["mobile", "altMobile", "occasionDate", "salespersonMobile"]);

export async function templateXlsx(locale: Locale, storeName: string): Promise<Buffer> {
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "import" });
  const book = new ExcelJS.Workbook();
  book.creator = storeName;

  const sheet = book.addWorksheet(t("template.sheet"), { views: [{ state: "frozen", ySplit: 1 }] });
  const header = sheet.addRow(IMPORT_COLUMNS.map((column) => t(`columns.${column}`)));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
  IMPORT_COLUMNS.forEach((column, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = Math.max(16, t(`columns.${column}`).length + 4);
    if (TEXT_COLUMNS.has(column)) col.numFmt = "@";
  });
  // Yes / No as a drop-down, in the reader's language and in English. A typing aid only —
  // the check accepts the words typed or pasted anywhere — so the first rows are enough.
  const consent = IMPORT_COLUMNS.indexOf("whatsapp") + 1;
  const choices = [...new Set([t("template.yes"), t("template.no"), "Yes", "No"])].join(",");
  for (let row = 2; row <= DROPDOWN_ROWS + 1; row += 1) {
    sheet.getCell(row, consent).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${choices}"`],
    };
  }

  const help = book.addWorksheet(t("template.helpSheet"));
  help.getColumn(1).width = 110;
  help.addRow([t("template.helpTitle")]).font = { bold: true, size: 13 };
  for (const key of ["h1", "h2", "h3", "h4", "h5", "h6", "h7"] as const)
    help.addRow([t(`template.help.${key}`, { max: formatNumber(IMPORT_MAX_ROWS, locale) })]);

  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function resultXlsx(
  locale: Locale,
  meta: { storeName: string; fileName: string; lines: string[] },
  outcomes: Outcome[],
): Promise<Buffer> {
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "import" });
  const tAll = createTranslator({ locale, messages });
  const book = new ExcelJS.Workbook();
  book.creator = meta.storeName;
  const sheet = book.addWorksheet(t("result.sheet"));
  sheet.addRow([meta.storeName]).font = { bold: true, size: 14 };
  sheet.addRow([t("result.title", { file: meta.fileName })]).font = { bold: true, size: 12 };
  for (const line of meta.lines) sheet.addRow([line]);
  sheet.addRow([]);
  const header = sheet.addRow([
    t("result.line"),
    t("columns.name"),
    t("columns.mobile"),
    t("result.outcome"),
    t("result.reason"),
  ]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
  sheet.autoFilter = {
    from: { row: header.number, column: 1 },
    to: { row: header.number, column: 5 },
  };
  sheet.views = [{ state: "frozen", ySplit: header.number }];

  const say = (message: { key: string; values?: Record<string, string | number> }) =>
    tAll.has(message.key as Parameters<typeof tAll>[0])
      ? tAll(message.key as Parameters<typeof tAll>[0], message.values ?? {})
      : message.key;
  for (const outcome of [...outcomes].sort((a, b) => a.line - b.line)) {
    const row = sheet.addRow([
      outcome.line,
      outcome.name,
      outcome.mobile,
      t(`result.${outcome.result}`),
      outcome.reasons.map(say).join("; "),
    ]);
    row.getCell(3).numFmt = "@";
  }
  [8, 28, 14, 14, 70].forEach((width, i) => (sheet.getColumn(i + 1).width = width));
  return Buffer.from(await book.xlsx.writeBuffer());
}
