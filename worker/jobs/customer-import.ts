import type { Job } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { runImport } from "@/lib/import/run";
import type { JobPayloads } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";

// M24. Retried like any job; each retry carries on from the last finished chunk. When the
// last try fails the import says so on its page instead of spinning for ever.
export async function handleCustomerImport(job: Job): Promise<void> {
  const { importJobId } = job.payload as JobPayloads["customer-import"];
  try {
    const ran = await runImport(importJobId);
    logger.info("job.import.done", { importJobId, ran });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.importJob.update({
      where: { id: importJobId },
      data: {
        error: message.slice(0, 2000),
        ...(job.attempts >= job.maxAttempts ? { status: "FAILED", finishedAt: new Date() } : {}),
      },
    });
    throw error;
  }
}
