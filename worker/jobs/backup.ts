import type { Job } from "@/generated/prisma/client";
import { backupDatabase } from "@/lib/backup";
import { db } from "@/lib/db";
import type { JobPayloads } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import { pushPending } from "@/lib/push";

export const BACKUP_FAILED = "backup-failed";

// M16.05. Retried like any job (1, 2, 4 minutes); when the last try fails, every active
// admin finds it in the bell (and on the phone), because a backup nobody knows is
// missing is worse than none.
export async function handleBackup(job: Job): Promise<void> {
  const { date } = job.payload as JobPayloads["db-backup"];
  try {
    const result = await backupDatabase();
    logger.info("job.backup.done", {
      date,
      file: result.file,
      bytes: result.bytes,
      removed: result.removed.length,
    });
  } catch (error) {
    if (job.attempts >= job.maxAttempts) {
      const admins = await db.user.findMany({
        where: { role: "ADMIN", status: "ACTIVE" },
        select: { id: true },
      });
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          type: BACKUP_FAILED,
          message: `${BACKUP_FAILED}:${date}`,
          link: "/notifications",
        })),
      });
      await pushPending().catch(() => 0);
    }
    throw error;
  }
}
