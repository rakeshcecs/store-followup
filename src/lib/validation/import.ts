import { z } from "zod";
import { id } from "@/lib/validation/common";

// M24: confirming a previewed import — what to do with customers who already exist, and
// the uploader's word that the WhatsApp "Yes" rows really agreed (module prompt).
export const startImportInput = z.object({
  jobId: id,
  updateExisting: z.boolean().default(false),
  whatsappConfirmed: z.boolean().default(false),
});

export const cancelImportInput = z.object({ jobId: id });
