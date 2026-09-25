// `npm run db:restore -- <backup file> <database>`: loads a backup made by db:backup or
// the worker into an existing database. Steps before and after: src/lib/backup.ts.
import "dotenv/config";
import { restoreDatabase } from "@/lib/backup";

const [file, database] = process.argv.slice(2);
if (!file || !database) {
  console.error("Usage: npm run db:restore -- <backup file .sql.gz> <database>");
  process.exit(1);
}

restoreDatabase({ file, database })
  .then(() => console.log(`Restored ${file} into ${database}.`))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
