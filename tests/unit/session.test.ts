import { describe, expect, it, vi } from "vitest";

// The session module pulls in next/headers and Prisma; neither is needed for the pure
// parts under test here.
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/lib/db", () => ({ db: {} }));

const { expiryFromNow, hashToken, needsTouch, SESSION_MAX_AGE } = await import("@/lib/session");

describe("hashToken", () => {
  it("returns the same 64-character hex for the same token", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never returns the token itself, which is the whole point of storing the hash", () => {
    expect(hashToken("abc")).not.toContain("abc");
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("expiry", () => {
  it("is 30 days away", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    expect(expiryFromNow(now).toISOString()).toBe("2026-10-23T10:00:00.000Z");
    expect(SESSION_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });
});

describe("needsTouch", () => {
  const now = new Date("2026-09-23T10:00:00Z");

  it("leaves a session seen today alone, so a busy screen writes nothing", () => {
    expect(needsTouch(new Date("2026-09-23T04:00:00Z"), now)).toBe(false);
  });

  it("pushes the expiry out once a day has passed", () => {
    expect(needsTouch(new Date("2026-09-21T10:00:00Z"), now)).toBe(true);
  });
});
