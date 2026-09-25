// M16.05: daily automatic database backup, kept 30 days. A gzipped `mysqldump` of the
// whole database, written by the worker at 02:00 IST into BACKUP_DIR, which lives on the
// server in India (production is in Mumbai). The managed database's own daily snapshots
// are the first line; this file is the copy we can read, move and restore ourselves.
//
// RESTORE (tested on 24 Sep 2026 against a copy, see docs/decisions.md):
//   1. Stop the app and the worker, so nothing writes while the data goes back.
//   2. npm run db:restore -- <backup file> <target database>
//      e.g. npm run db:restore -- /var/backups/followup/followup-2026-09-24-0200.sql.gz followup
//      Restore into a new, empty database first if you only need to look something up.
//   3. npx prisma migrate status   — the dump carries _prisma_migrations, so it must say
//      the schema is up to date; run `npx prisma migrate deploy` if the app is newer.
//   4. Start the app and the worker again.
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

export const BACKUP_KEEP_DAYS = 30;
const PREFIX = "followup-";
const SUFFIX = ".sql.gz";
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_MS = (5 * 60 + 30) * 60 * 1000;

export type DbConnection = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

// mysql://user:password@host:3306/database
export function dbConnection(url: string | undefined = process.env.DATABASE_URL): DbConnection {
  if (!url) throw new Error("DATABASE_URL is not set");
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "3306",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };
}

// "followup-2026-09-24-0200.sql.gz", in Indian time, so the name says the shop's day.
export function backupFileName(now: Date): string {
  const ist = new Date(now.getTime() + IST_MS).toISOString();
  return `${PREFIX}${ist.slice(0, 10)}-${ist.slice(11, 13)}${ist.slice(14, 16)}${SUFFIX}`;
}

// The password goes in MYSQL_PWD, never on the command line where `ps` would show it.
function run(
  command: string,
  args: string[],
  connection: DbConnection,
): { child: ReturnType<typeof spawn>; done: Promise<void> } {
  const child = spawn(command, args, {
    env: { ...process.env, MYSQL_PWD: connection.password },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)),
    );
  });
  return { child, done };
}

const common = (c: DbConnection) => [
  `--host=${c.host}`,
  `--port=${c.port}`,
  `--user=${c.user}`,
  "--default-character-set=utf8mb4",
];

export type BackupResult = { file: string; bytes: number; removed: string[] };

export async function backupDatabase(
  options: {
    dir?: string;
    keepDays?: number;
    now?: Date;
    url?: string;
    mysqldump?: string;
  } = {},
): Promise<BackupResult> {
  const dir = options.dir ?? process.env.BACKUP_DIR;
  if (!dir) throw new Error("BACKUP_DIR is not set");
  const now = options.now ?? new Date();
  const connection = dbConnection(options.url);
  await mkdir(dir, { recursive: true });

  const file = path.join(dir, backupFileName(now));
  const partial = `${file}.part`;
  const { child, done } = run(
    options.mysqldump ?? process.env.MYSQLDUMP_PATH ?? "mysqldump",
    [
      ...common(connection),
      // One consistent snapshot without locking the shop out while it runs.
      "--single-transaction",
      "--quick",
      "--no-tablespaces",
      connection.database,
    ],
    connection,
  );
  try {
    await Promise.all([pipeline(child.stdout!, createGzip(), createWriteStream(partial)), done]);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  // Only a finished dump gets the real name, so a crash never leaves a half file that
  // looks like a backup.
  await rename(partial, file);
  const { size } = await stat(file);
  const removed = await pruneBackups(dir, options.keepDays ?? BACKUP_KEEP_DAYS, now);
  return { file, bytes: size, removed };
}

// Our own files only, and only when older than `keepDays`.
export async function pruneBackups(dir: string, keepDays: number, now: Date): Promise<string[]> {
  const cutoff = now.getTime() - keepDays * DAY_MS;
  const removed: string[] = [];
  for (const name of await readdir(dir)) {
    if (!name.startsWith(PREFIX) || !name.endsWith(SUFFIX)) continue;
    const full = path.join(dir, name);
    if ((await stat(full)).mtime.getTime() < cutoff) {
      await unlink(full);
      removed.push(name);
    }
  }
  return removed;
}

// Loads a backup into `database` (which must exist). Used by `npm run db:restore`.
export async function restoreDatabase(options: {
  file: string;
  database: string;
  url?: string;
  mysql?: string;
}): Promise<void> {
  const connection = dbConnection(options.url);
  const { child, done } = run(
    options.mysql ?? process.env.MYSQL_PATH ?? "mysql",
    [...common(connection), options.database],
    connection,
  );
  await Promise.all([pipeline(createReadStream(options.file), createGunzip(), child.stdin!), done]);
}
