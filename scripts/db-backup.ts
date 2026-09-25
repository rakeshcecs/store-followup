// `npm run db:backup`: one backup now, the same one the worker makes every night (M16.05).
// Needs BACKUP_DIR; MYSQLDUMP_PATH when mysqldump is not on the PATH.
import "dotenv/config";
import { backupDatabase } from "@/lib/backup";

backupDatabase()
  .then(({ file, bytes, removed }) => {
    console.log(`Backup written: ${file} (${Math.round(bytes / 1024)} KB)`);
    if (removed.length) console.log(`Removed ${removed.length} older than 30 days.`);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
