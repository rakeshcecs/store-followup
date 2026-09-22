// Background worker entry: `npm run worker`. Runs jobs from the MySQL `jobs` table.
import "dotenv/config";
import { logger } from "@/lib/logger";
import { startWorker } from "./run";

startWorker().catch((error) => {
  logger.error("worker.crashed", error);
  process.exit(1);
});
