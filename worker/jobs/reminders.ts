import type { Job } from "@/generated/prisma/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import { pushPending } from "@/lib/push";
import {
  createManagerSummaries,
  createMorningSummaries,
  createSlotReminders,
} from "@/lib/reminders";

// Each writes its Notification rows, then pushes straight away rather than waiting for
// the next minute's push-pending run. A row already pushed is never pushed again.

export async function handleMorningReminders(job: Job): Promise<void> {
  const { date } = job.payload as JobPayloads["reminders-morning"];
  const written = await createMorningSummaries(date);
  logger.info("job.reminders.morning", { date, written, pushed: await pushPending() });
}

export async function handleSlotReminders(job: Job): Promise<void> {
  const { date, slot } = job.payload as JobPayloads["reminders-slot"];
  const written = await createSlotReminders(date, slot);
  logger.info("job.reminders.slot", { date, slot, written, pushed: await pushPending() });
}

export async function handleManagerSummary(job: Job): Promise<void> {
  const { date } = job.payload as JobPayloads["summary-manager"];
  const written = await createManagerSummaries(date);
  logger.info("job.summary.manager", { date, written, pushed: await pushPending() });
}
