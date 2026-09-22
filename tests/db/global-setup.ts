import { execSync } from "node:child_process";
import mariadb from "mariadb";
import type { TestProject } from "vitest/node";

// Recreates the test database and applies all migrations before the DB tests run.
export default async function setup(project: TestProject) {
  const testUrl = project.config.env.DATABASE_URL;
  if (!testUrl) throw new Error("Set DATABASE_URL in .env to run DB tests.");
  const url = new URL(testUrl);
  const database = url.pathname.slice(1);
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to reset "${database}": DB tests only run on a *_test database.`);
  }

  const conn = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await conn.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await conn.end();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
