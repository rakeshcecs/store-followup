// Minimal structured logger. Never pass customer or staff personal data (names, mobiles,
// action input) — log ids, codes and error details only.

type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

function write(level: Level, event: string, fields: Fields = {}, error?: unknown) {
  const line: Record<string, unknown> = { level, event, time: new Date().toISOString(), ...fields };
  if (error instanceof Error) {
    line.errorName = error.name;
    line.errorMessage = error.message;
    line.stack = error.stack;
  }
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.info(out);
}

export const logger = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, error: unknown, fields?: Fields) => write("error", event, fields, error),
};
