// M13 "Export to PDF": the store name, report name, filters used, date and time of export
// and page numbers (module prompt), with the table repeated across pages.
//
// Hindi and Gujarati need their own fonts, embedded (decisions.md, M18): Noto Sans for
// Latin, Noto Sans Devanagari and Noto Sans Gujarati, from @fontsource. No one font holds
// all three scripts — the Indic ones lack even the comma — so every string is split into
// runs by script and each run drawn in its own font. pdfkit shapes the Indic runs (fontkit),
// so conjuncts and vowel signs come out right.
import path from "node:path";
import PDFDocument from "pdfkit";
import type { ReportResult, ReportTable } from "@/lib/reports/core";
import type { ExportMeta } from "@/lib/reports/xlsx";
import { formatCell, isNumeric } from "@/lib/reports/format-cell";
import type { Locale } from "@/i18n/config";

type Script = "latin" | "deva" | "guj";
type Weight = "regular" | "bold";

const FONT_FILES: Record<Script, string> = {
  latin: "noto-sans/files/noto-sans-latin",
  deva: "noto-sans-devanagari/files/noto-sans-devanagari-devanagari",
  guj: "noto-sans-gujarati/files/noto-sans-gujarati-gujarati",
};

function fontPath(script: Script, weight: Weight): string {
  const file = `${FONT_FILES[script]}-${weight === "bold" ? 700 : 400}-normal.woff`;
  return path.join(process.cwd(), "node_modules", "@fontsource", file);
}

const fontName = (script: Script, weight: Weight) => `${script}-${weight}`;

function scriptOf(code: number): Script | null {
  if ((code >= 0x0900 && code <= 0x097f) || (code >= 0xa8e0 && code <= 0xa8ff)) return "deva";
  // The rupee sign is not in the Latin subset; the Devanagari one carries it.
  if (code === 0x20b9) return "deva";
  if (code >= 0x0a80 && code <= 0x0aff) return "guj";
  // Spaces and the joiners belong to whatever run they sit in.
  if (code === 0x20 || code === 0x200c || code === 0x200d) return null;
  return "latin";
}

// "Amit · अमित" → [latin "Amit · "], [deva "अमित"].
export function scriptRuns(text: string): { script: Script; text: string }[] {
  const runs: { script: Script; text: string }[] = [];
  for (const char of text) {
    const script = scriptOf(char.codePointAt(0)!) ?? runs.at(-1)?.script ?? "latin";
    const last = runs.at(-1);
    if (last && last.script === script) last.text += char;
    else runs.push({ script, text: char });
  }
  return runs;
}

type Doc = PDFKit.PDFDocument;

function widthOf(doc: Doc, text: string, size: number, weight: Weight): number {
  return scriptRuns(text).reduce(
    (sum, run) =>
      sum + doc.font(fontName(run.script, weight)).fontSize(size).widthOfString(run.text),
    0,
  );
}

// One line, cut with "…" when it would not fit.
function draw(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  weight: Weight,
  align: "left" | "right" = "left",
) {
  let value = text;
  if (widthOf(doc, value, size, weight) > width) {
    const chars = [...value];
    while (chars.length > 0 && widthOf(doc, `${chars.join("")}…`, size, weight) > width)
      chars.pop();
    value = `${chars.join("")}…`;
  }
  let cursor = align === "right" ? x + width - widthOf(doc, value, size, weight) : x;
  for (const run of scriptRuns(value)) {
    doc.font(fontName(run.script, weight)).fontSize(size);
    // One baseline for every font: the Indic fonts sit taller, and top-aligned runs of
    // different fonts would step up and down along the line.
    doc.text(run.text, cursor, y + size, { lineBreak: false, baseline: "alphabetic" });
    cursor += doc.widthOfString(run.text);
  }
}

// Rows measured to size the columns; the rest of a long report is like them.
const MEASURED_ROWS = 300;
const PAD = 6;

// Column widths by what is in them. Fixed shares per kind cut customer names in a
// ten-column report while "Slot" and "Method" sat half empty. Every column gets what its
// longest cell needs when that fits the page (spare room shared out); otherwise the
// narrow ones keep theirs and the wide ones split what is left, and only those cut.
function columnWidths(doc: Doc, table: ReportTable, pageWidth: number, locale: Locale): number[] {
  const lines = [
    ...table.rows.slice(0, MEASURED_ROWS).map((row) => ({ cells: row.cells, weight: "regular" })),
    ...(table.totals ? [{ cells: table.totals, weight: "bold" }] : []),
  ] as { cells: ReportTable["rows"][number]["cells"]; weight: Weight }[];
  const natural = table.columns.map(
    (column) =>
      Math.max(
        widthOf(doc, column.label, SIZE, "bold"),
        ...lines.map((line) =>
          widthOf(
            doc,
            formatCell(column, line.cells[column.key] ?? null, locale),
            SIZE,
            line.weight,
          ),
        ),
      ) + PAD,
  );
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= pageWidth)
    return natural.map((width) => width + ((pageWidth - total) * width) / total);

  const widths: (number | null)[] = natural.map(() => null);
  let room = pageWidth;
  for (;;) {
    const open = widths.flatMap((width, i) => (width === null ? [i] : []));
    if (open.length === 0) return widths as number[];
    const share = room / open.length;
    const fits = open.filter((i) => natural[i]! <= share);
    if (fits.length === 0) {
      for (const i of open) widths[i] = share;
      return widths as number[];
    }
    for (const i of fits) {
      widths[i] = natural[i]!;
      room -= natural[i]!;
    }
  }
}

// A PDF is for reading and printing; past this many rows it is a phone book, and Excel
// has them all. The export route cuts the main table here and says so at the top.
export const PDF_MAX_ROWS = 2_000;

const MARGIN = 36;
const SIZE = 8.5;
const ROW = 17;

export async function toPdf(
  meta: ExportMeta,
  result: ReportResult,
  locale: Locale,
): Promise<Buffer> {
  const wide = Math.max(0, ...result.tables.map((table) => table.columns.length)) > 6;
  const doc = new PDFDocument({
    size: "A4",
    layout: wide ? "landscape" : "portrait",
    margin: MARGIN,
    bufferPages: true,
    info: { Title: meta.title, Author: meta.storeName },
  });
  for (const script of Object.keys(FONT_FILES) as Script[]) {
    for (const weight of ["regular", "bold"] as Weight[]) {
      doc.registerFont(fontName(script, weight), fontPath(script, weight));
    }
  }
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const pageWidth = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 18;
  let y = MARGIN;

  // The heading, once, on the first page.
  draw(doc, meta.storeName, MARGIN, y, pageWidth, 10, "bold");
  y += 15;
  draw(doc, meta.title, MARGIN, y, pageWidth, 16, "bold");
  y += 24;
  for (const line of [...meta.lines, meta.exportedAt]) {
    draw(doc, line, MARGIN, y, pageWidth, 9, "regular");
    y += 13;
  }
  y += 8;

  const tableHeader = (table: ReportTable, widths: number[]) => {
    doc.rect(MARGIN, y - 4, pageWidth, ROW).fill("#E8EAF6");
    doc.fillColor("#1F2433");
    let x = MARGIN;
    table.columns.forEach((column, i) => {
      draw(
        doc,
        column.label,
        x + 3,
        y,
        widths[i]! - 6,
        SIZE,
        "bold",
        isNumeric(column) ? "right" : "left",
      );
      x += widths[i]!;
    });
    y += ROW;
  };

  for (const table of result.tables) {
    const widths = columnWidths(doc, table, pageWidth, locale);

    if (y + ROW * 3 > bottom()) {
      doc.addPage();
      y = MARGIN;
    }
    if (table.title) {
      draw(doc, table.title, MARGIN, y, pageWidth, 11, "bold");
      y += 18;
    }
    tableHeader(table, widths);

    const lines = [
      ...table.rows.map((row) => ({ cells: row.cells, bold: false })),
      ...(table.totals ? [{ cells: table.totals, bold: true }] : []),
    ];
    lines.forEach((line, index) => {
      // The totals never start a page alone: the last row goes over with them.
      const keep = table.totals && index === lines.length - 2 ? 2 : 1;
      if (y + ROW * keep > bottom()) {
        doc.addPage();
        y = MARGIN;
        tableHeader(table, widths);
      }
      if (line.bold) {
        doc
          .moveTo(MARGIN, y - 4)
          .lineTo(MARGIN + pageWidth, y - 4)
          .lineWidth(0.8)
          .stroke("#1F2433");
      } else if (index % 2 === 1) {
        doc.rect(MARGIN, y - 4, pageWidth, ROW).fill("#F6F6F4");
      }
      doc.fillColor("#1F2433");
      let x = MARGIN;
      table.columns.forEach((column, i) => {
        const text = formatCell(column, line.cells[column.key] ?? null, locale);
        draw(
          doc,
          text,
          x + 3,
          y,
          widths[i]! - 6,
          SIZE,
          line.bold ? "bold" : "regular",
          isNumeric(column) ? "right" : "left",
        );
        x += widths[i]!;
      });
      y += ROW;
    });
    y += 14;
  }

  // "Page 1 of 3" on every page, now that the count is known.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    // Inside the bottom margin on purpose: pdfkit would otherwise start a new page.
    doc.page.margins.bottom = 0;
    const label = `${i + 1} / ${range.count}`;
    draw(doc, meta.title, MARGIN, doc.page.height - MARGIN - 6, pageWidth / 2, 8, "regular");
    draw(
      doc,
      label,
      MARGIN + pageWidth / 2,
      doc.page.height - MARGIN - 6,
      pageWidth / 2,
      8,
      "regular",
      "right",
    );
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
