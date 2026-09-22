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
          include: ["src/components/**/*.test.tsx", "src/hooks/**/*.test.tsx"],
          setupFiles: ["tests/ui-setup.ts"],
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
