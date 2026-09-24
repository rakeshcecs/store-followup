// Drops the database, re-applies every migration and seeds it, so a run starts from the
// same place a new store would:
//
//   npm run db:reset        one branch and the admin — what a real new store looks like
//   npm run db:reset:demo   two branches, a manager and a salesperson in each, plus the
//                           admin; the first manager covers both branches, so the branch
//                           switcher and "All branches" can be tried by hand
//
// The demo flag lives here rather than in .env on purpose: .env is copied to servers and
// this data must never reach one, and a flag nobody has to remember cannot be left on by
// accident. `npm run test:e2e:fresh` is the first half of this script with the flag off.
//
// It refuses to touch anything that is not a local development database, because the
// whole point of the script is that it destroys data.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createConnection } from "mariadb";

const run = (...args: string[]) =>
  execFileSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });

async function main() {
  // The seed reads SEED_DEMO from the environment the child process inherits.
  if (process.argv.includes("--demo")) process.env["SEED_DEMO"] = "true";

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
