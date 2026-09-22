import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { db?: PrismaClient };

// Every connection stores times in UTC (the app shows IST) and uses strict SQL mode,
// so bad values fail instead of being silently truncated.
const SESSION_SQL = [
  "SET time_zone = '+00:00'",
  "SET sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
];

// `next build` imports this file without DATABASE_URL (e.g. in Docker). The pool only connects
// on the first query, so a placeholder is safe there; at runtime a missing URL fails that query.
const PLACEHOLDER_URL = "mysql://missing-database-url:3306/unset";

function createClient() {
  const url = new URL(process.env.DATABASE_URL || PLACEHOLDER_URL);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    timezone: "Z",
    initSql: SESSION_SQL,
  });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.db ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.db = db;
