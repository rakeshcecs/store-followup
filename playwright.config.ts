// Playwright is not Next, so nothing has read .env yet: without this the specs' own
// `db` falls back to the placeholder URL in src/lib/db.ts and every query pool-timeouts.
import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a production build (`npm run build` first).
// Locally: stop `npm run dev` before building — both write to .next.
const port = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // A save redirects through "/" and a role check; with every worker on one machine that
  // hop has outlasted the default five seconds (flaky runs, never a wrong screen).
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run start -- -p ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
