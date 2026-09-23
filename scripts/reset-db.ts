// Drops the database, re-applies every migration and seeds it, so a run starts from the
// same place a new store would: `npm run db:reset`. It is also the first half of
// `npm run test:e2e:fresh`.
//
// It refuses to touch anything that is not a local development database, because the
// whole point of the script is that it destroys data.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createConnection } from "mariadb";

const run = (...args: string[]) =>
  execFileSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const database = url.pathname.slice(1);

  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`Refusing to drop ${database} on ${url.hostname}: this is for local use only.`);
  }

  const connection = await createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });

  await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await connection.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.end();
  console.log(`Dropped and recreated ${database}.`);

  run("prisma", "migrate", "deploy");
  run("prisma", "db", "seed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
