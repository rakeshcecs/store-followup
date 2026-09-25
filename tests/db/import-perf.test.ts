import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const { prepareImport } = await import("@/lib/import/prepare");
const { runImport } = await import("@/lib/import/run");
const { startImport } = await import("@/lib/actions/import");
const { IMPORT_COLUMNS } = await import("@/lib/import/types");
const { makeStore } = await import("../helpers/store");
const { signInAs } = await import("../helpers/session");
import en from "../../messages/en.json";

// M24 "Done when": a 20,000-row file imports in under 3 minutes. A full .xlsx, every
// column filled, through the same preview and worker run as the screen.
const ROWS = 20_000;
const BUDGET_MS = 3 * 60 * 1000;
let store: Awaited<ReturnType<typeof makeStore>>;
let file: ArrayBuffer;
const base = 6_100_000_000 + Math.floor(Math.random() * 800_000_000);

beforeAll(async () => {
  store = await makeStore();
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Customers");
  sheet.addRow(IMPORT_COLUMNS.map((c) => en.import.columns[c]));
  for (let i = 0; i < ROWS; i += 1) {
    sheet.addRow([
      `Perf Customer ${i}`,
      String(base + i),
      "",
      "Adajan",
      "Surat",
      "",
      "Wedding",
      "05-12-2026",
      store.salesA.mobile,
      i % 2 ? "Yes" : "No",
    ]);
  }
  file = (await book.xlsx.writeBuffer()) as ArrayBuffer;
}, 120_000);

afterAll(async () => {
  const mobiles = Array.from({ length: ROWS }, (_, i) => String(base + i));
  const ids = (
    await db.customer.findMany({ where: { mobile: { in: mobiles } }, select: { id: true } })
  ).map((c) => c.id);
  await db.timelineEvent.deleteMany({ where: { customerId: { in: ids } } });
  await db.customer.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}, 120_000);

describe("20,000 rows", () => {
  it(
    "preview and import in under 3 minutes",
    async () => {
      const began = performance.now();
      const prepared = await prepareImport({
        bytes: file,
        fileName: "perf.xlsx",
        branchId: store.branchA.id,
        uploaderId: store.managerA.id,
      });
      const previewMs = performance.now() - began;
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      const job = await db.importJob.findUniqueOrThrow({ where: { id: prepared.jobId } });
      expect(job).toMatchObject({ totalRows: ROWS, readyRows: ROWS, errorRows: 0 });

      await signInAs(store.managerA.mobile);
      expect(await startImport({ jobId: job.id, whatsappConfirmed: true })).toMatchObject({
        ok: true,
      });
      const runStart = performance.now();
      await runImport(job.id);
      const runMs = performance.now() - runStart;
      const total = performance.now() - began;
      console.log(
        `import: preview ${(previewMs / 1000).toFixed(1)} s, run ${(runMs / 1000).toFixed(1)} s, total ${(total / 1000).toFixed(1)} s`,
      );
      const done = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(done).toMatchObject({ status: "DONE", imported: ROWS });
      expect(total).toBeLessThan(BUDGET_MS);
    },
    BUDGET_MS + 60_000,
  );
});
