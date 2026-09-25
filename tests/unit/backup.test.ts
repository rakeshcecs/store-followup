import { mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupFileName, dbConnection, pruneBackups } from "@/lib/backup";

// M16.05: the file name, the connection read from DATABASE_URL, and the 30-day clean-up.
describe("backup", () => {
  it("names the file by the Indian day and time", () => {
    // 20:30 UTC on the 23rd is 02:00 IST on the 24th.
    expect(backupFileName(new Date("2026-09-23T20:30:00.000Z"))).toBe(
      "followup-2026-09-24-0200.sql.gz",
    );
  });

  it("reads the connection from the database URL", () => {
    expect(dbConnection("mysql://app:p%40ss@db.example:3307/followup")).toEqual({
      host: "db.example",
      port: "3307",
      user: "app",
      password: "p@ss",
      database: "followup",
    });
    expect(dbConnection("mysql://root:@localhost/followup").port).toBe("3306");
  });

  it("removes only its own files older than 30 days", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "backup-test-"));
    const now = new Date("2026-09-24T00:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    const files = {
      "followup-2026-08-01-0200.sql.gz": 54,
      "followup-2026-09-20-0200.sql.gz": 4,
      "notes.txt": 90,
    };
    for (const [name, age] of Object.entries(files)) {
      const full = path.join(dir, name);
      await writeFile(full, "x");
      const at = new Date(now.getTime() - age * day);
      await utimes(full, at, at);
    }
    expect(await pruneBackups(dir, 30, now)).toEqual(["followup-2026-08-01-0200.sql.gz"]);
    expect((await readdir(dir)).sort()).toEqual(["followup-2026-09-20-0200.sql.gz", "notes.txt"]);
  });
});
