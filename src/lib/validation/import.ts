import { z } from "zod";
import { id } from "@/lib/validation/common";

// M24: confirming a previewed import — what to do with customers who already exist.
export const startImportInput = z.object({
  jobId: id,
  updateExisting: z.boolean().default(false),
});

export const cancelImportInput = z.object({ jobId: id });
