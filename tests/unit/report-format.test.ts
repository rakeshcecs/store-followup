import { describe, expect, it } from "vitest";
import { scriptRuns } from "@/lib/reports/pdf";
import { formatCell } from "@/lib/reports/format-cell";
import { chosenSort, pageOf, parseFilters, reportRange, sortRows } from "@/lib/reports/core";
import { REPORTS } from "@/lib/reports/definitions";

// M13: the pure parts of the reports — cells, PDF script runs, filters, sort and pages.

describe("formatCell", () => {
  const col = (kind: "day" | "datetime" | "number" | "percent" | "money" | "mobile") => ({
    key: "k",
    label: "K",
    kind,
  });

  it("formats each kind in the reader's language", () => {
    expect(formatCell(col("day"), "2026-09-24", "en")).toBe("24 Sep 2026");
    expect(formatCell(col("number"), 125000, "en")).toBe("1,25,000");
    expect(formatCell(col("percent"), 25, "en")).toBe("25%");
    expect(formatCell(col("money"), 125000, "en")).toBe("₹1,25,000");
    expect(formatCell(col("mobile"), "9876543210", "en")).toBe("98765 43210");
  });

  it("leaves the totals row's word alone in a date column", () => {
    expect(formatCell(col("day"), "Total", "en")).toBe("Total");
    expect(formatCell(col("datetime"), "कुल", "hi")).toBe("कुल");
    expect(formatCell(col("day"), null, "en")).toBe("");
  });
});

describe("scriptRuns (PDF fonts)", () => {
  it("splits text by script; spaces stay with their run; ₹ goes to Devanagari", () => {
    expect(scriptRuns("Amit अमित શર્મા")).toEqual([
      { script: "latin", text: "Amit " },
      { script: "deva", text: "अमित " },
      { script: "guj", text: "શર્મા" },
    ]);
    expect(scriptRuns("₹500").map((run) => run.script)).toEqual(["deva", "latin"]);
    // The comma is not in the Indic fonts.
    expect(scriptRuns("कीमत, डिज़ाइन").map((run) => run.script)).toEqual(["deva", "latin", "deva"]);
  });
});

describe("filters, sorting, paging", () => {
  it("drops empty and unknown values", () => {
    const f = parseFilters({
      salesperson: "",
      status: "sideways",
      page: "3",
      outcome: "PURCHASED",
    });
    expect(f.salesperson).toBeUndefined();
    expect(f.status).toBeUndefined();
    expect(f).toMatchObject({ page: 3, outcome: "PURCHASED" });
  });

  it("defaults to this month; refuses backwards or over a year", () => {
    const today = "2026-09-24";
    expect(reportRange(parseFilters({}), today)).toEqual({ from: "2026-09-01", to: today });
    expect(reportRange(parseFilters({ from: "2026-09-10", to: "2026-09-01" }), today).from).toBe(
      "2026-09-01",
    );
    expect(reportRange(parseFilters({ from: "2025-01-01", to: "2026-09-01" }), today).from).toBe(
      "2026-09-01",
    );
    expect(reportRange(parseFilters({ from: "2026-01-01", to: "2026-06-30" }), today)).toEqual({
      from: "2026-01-01",
      to: "2026-06-30",
    });
  });

  it("sorts numbers as numbers and puts blanks last", () => {
    const rows = [5, null, 30, 4].map((n) => ({ cells: { n } }));
    expect(sortRows(rows, "n", "asc", "en").map((r) => r.cells.n)).toEqual([4, 5, 30, null]);
    expect(sortRows(rows, "n", "desc", "en").map((r) => r.cells.n)).toEqual([30, 5, 4, null]);
  });

  it("only sorts by the report's own columns", () => {
    const table = {
      key: "t",
      columns: [{ key: "amount", label: "A", kind: "money" as const }],
      rows: [],
    };
    expect(chosenSort(REPORTS.r5, table, parseFilters({ sort: "amount", dir: "desc" }))).toEqual({
      key: "amount",
      dir: "desc",
    });
    expect(chosenSort(REPORTS.r5, table, parseFilters({ sort: "pinHash" }))).toEqual(
      REPORTS.r5.defaultSort,
    );
  });

  it("pages 50 rows at a time, and a page past the end shows the last", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    expect(pageOf(rows, 1)).toMatchObject({ page: 1, pages: 3 });
    expect(pageOf(rows, 3).rows).toHaveLength(20);
    expect(pageOf(rows, 9).page).toBe(3);
  });
});
