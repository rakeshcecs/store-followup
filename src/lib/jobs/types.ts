// Every job type and its payload. Payloads hold ids only — never names or mobile numbers.
export type JobPayloads = {
  test: { note: string };
  "purge-jobs": Record<string, never>;
};

export type JobType = keyof JobPayloads;
