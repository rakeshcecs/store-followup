import type { TimeSlot } from "@/generated/prisma/client";

// Every job type and its payload. Payloads hold ids only — never names or mobile numbers.
export type JobPayloads = {
  test: { note: string };
  "purge-jobs": Record<string, never>;
  // M14. `date` is the IST calendar day the reminder is for ("2026-09-24").
  "reminders-morning": { date: string };
  "reminders-slot": { date: string; slot: TimeSlot };
  "summary-manager": { date: string };
  // M16.05: the nightly database backup.
  "db-backup": { date: string };
  // M24: run a confirmed customer import.
  "customer-import": { importJobId: string };
  // M23: set today's occasion follow-ups.
  "occasion-follow-ups": { date: string };
};

export type JobType = keyof JobPayloads;
