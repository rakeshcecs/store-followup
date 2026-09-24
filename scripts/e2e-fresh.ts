// `npm run test:e2e:fresh` — the whole app walked start to finish on a database that has
// just been created: reset, then Playwright with the flag tests/e2e/fresh-install.spec.ts
// waits for. The flag is set here rather than in the npm script because `VAR=1 cmd` is
// not a thing on Windows, which is where this project is developed.
import { execFileSync } from "node:child_process";

const run = (args: string[], env: Record<string, string> = {}) =>
  execFileSync("npx", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });

// SEED_DEMO=false whatever the .env says: the walkthrough counts branches and staff as it
// goes ("the admin sees the seeded branch and adds a second one"), so a demo store seeded
// underneath it would make every one of those numbers wrong.
run(["tsx", "scripts/reset-db.ts"], { SEED_DEMO: "false" });
// One project and one worker: this is a single story, and running it twice over would
// find the seeded PIN already changed by the first pass.
run(
  [
    "playwright",
    "test",
    "tests/e2e/fresh-install.spec.ts",
    "--project=desktop",
    "--workers=1",
    ...process.argv.slice(2),
  ],
  { FRESH_INSTALL: "1" },
);
