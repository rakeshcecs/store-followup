// M24 upload: read the file, check every row against the database, and keep the result
// on an ImportJob waiting for the user's confirmation. Nothing is imported here.
//
// branch-scope-exempt: the job is written to the branch the caller checked; customers are
// shared across branches (BR-16), so duplicates are looked for everywhere.
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { checkRows, numbersIn } from "@/lib/import/check";
import { readImportFile } from "@/lib/import/read";
import { IMPORT_MAX_ROWS, type ImportRow } from "@/lib/import/types";

const LOOKUP_CHUNK = 1_000;

async function inChunks<T>(values: string[], load: (chunk: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += LOOKUP_CHUNK)
    out.push(...(await load(values.slice(i, i + LOOKUP_CHUNK))));
  return out;
}

// Customers who already have one of these numbers, as main or alternate.
export async function existingByNumber(numbers: string[]): Promise<Map<string, string>> {
  const rows = await inChunks(numbers, (chunk) =>
    db.customer.findMany({
      where: { OR: [{ mobile: { in: chunk } }, { altMobile: { in: chunk } }] },
      select: { id: true, mobile: true, altMobile: true },
    }),
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.mobile) map.set(row.mobile, row.id);
    if (row.altMobile && !map.has(row.altMobile)) map.set(row.altMobile, row.id);
  }
  return map;
}

export type PrepareResult = { ok: true; jobId: string } | { ok: false; error: string };

export async function prepareImport(input: {
  bytes: ArrayBuffer;
  fileName: string;
  branchId: string;
  uploaderId: string;
}): Promise<PrepareResult> {
  const read = await readImportFile(input.bytes, input.fileName);
  if (!read.ok) return read;
  if (read.rows.length > IMPORT_MAX_ROWS) return { ok: false, error: "import.errors.tooMany" };

  const numbers = numbersIn(read.rows, read.columns);
  const [staff, departments, existing] = await Promise.all([
    db.user.findMany({
      where: {
        mobile: { in: numbers.staff },
        status: "ACTIVE",
        role: { in: ["SALESPERSON", "MANAGER"] },
        OR: [
          { homeBranchId: input.branchId },
          { extraBranches: { some: { branchId: input.branchId } } },
        ],
      },
      select: { id: true, mobile: true },
    }),
    db.department.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
    existingByNumber(numbers.customers),
  ]);

  const rows: ImportRow[] = checkRows(read.rows, read.columns, {
    uploaderId: input.uploaderId,
    staffByMobile: new Map(staff.map((person) => [person.mobile, person.id])),
    departments: new Map(departments.map((d) => [d.name.toLowerCase(), d.id])),
    existing,
  });
  const count = (state: ImportRow["state"]) => rows.filter((row) => row.state === state).length;

  const job = await db.importJob.create({
    data: {
      branchId: input.branchId,
      fileName: input.fileName.slice(0, 255),
      uploadedById: input.uploaderId,
      totalRows: rows.length,
      readyRows: count("ready"),
      errorRows: count("error"),
      existingRows: count("exists"),
      rows: rows as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { ok: true, jobId: job.id };
}
