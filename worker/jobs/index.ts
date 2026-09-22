import type { Job } from "@/generated/prisma/client";
import type { JobType } from "@/lib/jobs/types";
import { handlePurgeJobs } from "./purge-jobs";
import { handleTest } from "./test";

export type JobHandler = (job: Job) => Promise<void>;

// One handler per job type in src/lib/jobs/types.ts.
export const handlers: Record<JobType, JobHandler> = {
  test: handleTest,
  "purge-jobs": handlePurgeJobs,
};
