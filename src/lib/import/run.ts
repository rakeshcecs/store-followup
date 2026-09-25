// M24: the import itself, run by the worker (job "customer-import"), never by a request,
// so a 20,000-row file does not hold up the app. Chunks of 500 rows, each chunk in one
// transaction with the job's counters: a retry after a crash starts at the next chunk and
// nothing is imported or counted twice. Every number is checked again here, because
// customers may have been added between the preview and the run (BR-01).
//
// branch-scope-exempt: the job carries the branch the uploader was allowed; customers are
// shared across branches (BR-16), so duplicates are looked for everywhere.
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { IMPORT_CHUNK, type ImportRow, type Message, type Outcome } from "@/lib/import/types";
import { TIMELINE } from "@/lib/timeline";

const reason = (key: string, values?: Message["values"]): Message => ({
  key: `import.reasons.${key}`,
  ...(values ? { values } : {}),
});

const calendar = (day: string | null) => (day ? new Date(`${day}T00:00:00.000Z`) : null);

export type ImportCounts = { imported: number; updated: number; skipped: number };

// The rows the worker handles: everything the preview did not reject.
export const workRows = (rows: ImportRow[]) => rows.filter((row) => row.state !== "error");

async function runChunk(
  tx: Prisma.TransactionClient,
  job: {
    id: string;
    branchId: string;
    uploadedById: string;
    updateExisting: boolean;
  },
  chunk: ImportRow[],
  now: Date,
): Promise<ImportCounts & { outcomes: Outcome[] }> {
  const outcomes: Outcome[] = [];
  const counts = { imported: 0, updated: 0, skipped: 0 };
  const outcome = (row: ImportRow, result: Outcome["result"], reasons: Message[]) =>
    outcomes.push({ line: row.line, name: row.name, mobile: row.mobile, result, reasons });

  // Who has these numbers now.
  const numbers = chunk.flatMap((row) => [row.mobile, ...(row.altMobile ? [row.altMobile] : [])]);
  const owners = await tx.customer.findMany({
    where: { OR: [{ mobile: { in: numbers } }, { altMobile: { in: numbers } }] },
    select: {
      id: true,
      mobile: true,
      altMobile: true,
      area: true,
      city: true,
      departmentId: true,
      occasion: true,
      occasionDate: true,
    },
  });
  const byNumber = new Map<string, (typeof owners)[number]>();
  for (const owner of owners) {
    if (owner.mobile) byNumber.set(owner.mobile, owner);
    if (owner.altMobile && !byNumber.has(owner.altMobile)) byNumber.set(owner.altMobile, owner);
  }

  const notesFor = (row: ImportRow) => row.notes;

  // New customers.
  const fresh: { row: ImportRow; id: string }[] = [];
  for (const row of chunk) {
    const owner = byNumber.get(row.mobile);
    if (owner) {
      if (!job.updateExisting) {
        outcome(row, "skipped", [reason("exists")]);
        counts.skipped += 1;
        continue;
      }
      // "Update empty fields only": fill what is blank, change nothing that is set.
      const altFree =
        row.altMobile &&
        (!byNumber.has(row.altMobile) || byNumber.get(row.altMobile)!.id === owner.id);
      const patch: Prisma.CustomerUncheckedUpdateInput = {
        ...(!owner.altMobile && altFree && row.altMobile !== owner.mobile
          ? { altMobile: row.altMobile }
          : {}),
        ...(!owner.area && row.area ? { area: row.area } : {}),
        ...(!owner.city && row.city ? { city: row.city } : {}),
        ...(!owner.departmentId && row.departmentId ? { departmentId: row.departmentId } : {}),
        ...(!owner.occasion && row.occasion ? { occasion: row.occasion } : {}),
        ...(!owner.occasionDate && row.occasionDate
          ? { occasionDate: calendar(row.occasionDate) }
          : {}),
      };
      if (Object.keys(patch).length === 0) {
        outcome(row, "skipped", [reason("nothingToAdd")]);
        counts.skipped += 1;
        continue;
      }
      await tx.customer.update({
        where: { id: owner.id },
        data: { ...patch, updatedById: job.uploadedById },
      });
      await tx.timelineEvent.create({
        data: {
          customerId: owner.id,
          ...TIMELINE.importUpdated,
          staffId: job.uploadedById,
          branchId: job.branchId,
          entityId: job.id,
        },
      });
      counts.updated += 1;
      const notes = notesFor(row);
      if (notes.length) outcome(row, "updated", notes);
      continue;
    }
    // An alternate taken since the preview would make search find two people.
    if (row.altMobile && byNumber.has(row.altMobile)) {
      outcome(row, "skipped", [reason("altTaken")]);
      counts.skipped += 1;
      continue;
    }
    fresh.push({ row, id: randomUUID() });
  }

  if (fresh.length > 0) {
    await tx.customer.createMany({
      // A number saved by someone else in the same instant loses quietly here and is
      // reported below; the unique index is what guarantees BR-01.
      skipDuplicates: true,
      data: fresh.map(({ row, id }) => ({
        id,
        name: row.name,
        mobile: row.mobile,
        altMobile: row.altMobile,
        area: row.area,
        city: row.city,
        departmentId: row.departmentId,
        occasion: row.occasion,
        occasionDate: calendar(row.occasionDate),
        assignedToId: row.assignedToId,
        homeBranchId: job.branchId,
        source: "IMPORT",
        // The file cannot show the customer agreed to be saved (M05.08); a salesperson
        // records it on the profile when they next meet.
        consentGiven: false,
        createdById: job.uploadedById,
        updatedById: job.uploadedById,
      })),
    });
    const saved = new Set(
      (
        await tx.customer.findMany({
          where: { id: { in: fresh.map((f) => f.id) } },
          select: { id: true },
        })
      ).map((c) => c.id),
    );
    await tx.timelineEvent.createMany({
      data: fresh
        .filter(({ id }) => saved.has(id))
        .map(({ id }) => ({
          id: randomUUID(),
          customerId: id,
          ...TIMELINE.imported,
          staffId: job.uploadedById,
          branchId: job.branchId,
          entityId: job.id,
          createdAt: now,
        })),
    });
    for (const { row, id } of fresh) {
      if (!saved.has(id)) {
        outcome(row, "skipped", [reason("exists")]);
        counts.skipped += 1;
        continue;
      }
      counts.imported += 1;
      const notes = notesFor(row);
      if (notes.length) outcome(row, "imported", notes);
    }
  }
  return { ...counts, outcomes };
}

// Runs (or resumes) one confirmed import. Returns false when there was nothing to do.
export async function runImport(jobId: string, now = () => new Date()): Promise<boolean> {
  const job = await db.importJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "PROCESSING") return false;
  const rows = workRows((job.rows ?? []) as unknown as ImportRow[]);

  for (let start = job.processed; start < rows.length; start += IMPORT_CHUNK) {
    const chunk = rows.slice(start, start + IMPORT_CHUNK);
    await db.$transaction(
      async (tx) => {
        // Read inside the transaction: a second worker on the same job waits here and
        // then sees the chunk is done.
        const [fresh] = await tx.$queryRaw<{ processed: number; status: string }[]>`
          SELECT processed, status FROM import_jobs WHERE id = ${job.id} FOR UPDATE`;
        if (!fresh || fresh.status !== "PROCESSING" || fresh.processed !== start) return;
        const result = await runChunk(tx, job, chunk, now());
        const current = await tx.importJob.findUniqueOrThrow({
          where: { id: job.id },
          select: { outcomes: true },
        });
        await tx.importJob.update({
          where: { id: job.id },
          data: {
            processed: start + chunk.length,
            imported: { increment: result.imported },
            updated: { increment: result.updated },
            skipped: { increment: result.skipped },
            outcomes: [
              ...((current.outcomes ?? []) as unknown as Outcome[]),
              ...result.outcomes,
            ] as unknown as Prisma.InputJsonValue,
          },
        });
      },
      { timeout: 60_000 },
    );
  }

  await db.$transaction(async (tx) => {
    // Only the run that finishes it: a second worker on the same job (a stale lock
    // released) must not write "done" and its audit row again.
    const finished = await tx.importJob.updateMany({
      where: { id: job.id, status: "PROCESSING" },
      data: {
        status: "DONE",
        finishedAt: now(),
        resultFileUrl: `/import/${job.id}/result`,
        error: null,
        // The file's rows are a copy of someone's customer list; the result file reads
        // `outcomes`, so nothing needs them now (same as a cancelled import).
        rows: Prisma.DbNull,
      },
    });
    if (finished.count === 0) return;
    const done = await tx.importJob.findUniqueOrThrow({ where: { id: job.id } });
    await writeAudit(tx, {
      userId: job.uploadedById,
      branchId: job.branchId,
      action: AUDIT.importDone,
      entityType: "ImportJob",
      entityId: job.id,
      newValue: {
        fileName: done.fileName,
        totalRows: done.totalRows,
        imported: done.imported,
        updated: done.updated,
        skipped: done.skipped,
        mistakes: done.errorRows,
      },
      device: null,
    });
  });
  return true;
}

// The rows the preview rejected go straight into the result file.
export function errorOutcomes(rows: ImportRow[]): Outcome[] {
  return rows
    .filter((row) => row.state === "error")
    .map((row) => ({
      line: row.line,
      name: row.name,
      mobile: row.mobile,
      result: "skipped" as const,
      reasons: row.errors,
    }));
}
