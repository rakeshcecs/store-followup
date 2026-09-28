import "dotenv/config";
import { defineConfig } from "vitest/config";

// DB tests use a separate database on the same server as DATABASE_URL, named "<name>_test".
function testDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) return "";
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname.slice(1)}_test`;
  return url.toString();
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: [
            "src/app/**/*.test.tsx",
            "src/components/**/*.test.tsx",
            "src/hooks/**/*.test.tsx",
          ],
          setupFiles: ["tests/ui-setup.ts"],
        },
      },
      // M20: the fixture notes against the real model. Costs money and needs the key, so
      // it is its own command (`npm run test:ai`) and never part of `npm test`.
      {
        extends: true,
        test: {
          name: "ai",
          environment: "node",
          include: ["tests/ai/**/*.test.ts"],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          env: { DATABASE_URL: testDatabaseUrl() },
          fileParallelism: false,
        },
      },
    ],
  },
});
