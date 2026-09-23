import { beforeEach, describe, expect, it, vi } from "vitest";

// The property this file exists for: with no session cookie, nothing may query the
// database. `src/i18n/locale.ts` calls getUser() on every request, including the offline
// page and the error boundary, and a signed-out visitor must cost zero queries.
const cookieValue = vi.hoisted(() => ({ token: undefined as string | undefined }));
const findUnique = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "session" && cookieValue.token ? { name, value: cookieValue.token } : undefined,
  }),
}));
vi.mock("@/lib/db", () => ({ db: { session: { findUnique } } }));

const { getUser, requireUser, landingPath } = await import("@/lib/auth");

beforeEach(() => {
  cookieValue.token = undefined;
  findUnique.mockReset();
});

describe("getUser with no cookie", () => {
  it("returns null without touching the database", async () => {
    await expect(getUser()).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("getUser with a cookie", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "session-1",
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: "user-1",
      role: "MANAGER",
      status: "ACTIVE",
      homeBranchId: "branch-1",
      language: "hi",
      extraBranches: [{ branchId: "branch-2" }],
    },
    ...overrides,
  });

  it("returns the user with home branch first in branchIds", async () => {
    cookieValue.token = "a-token";
    findUnique.mockResolvedValue(row());

    await expect(getUser()).resolves.toEqual({
      id: "user-1",
      role: "MANAGER",
      homeBranchId: "branch-1",
      branchIds: ["branch-1", "branch-2"],
      language: "hi",
    });
  });

  it("looks the session up by the hash, never by the token itself", async () => {
    cookieValue.token = "a-token";
    findUnique.mockResolvedValue(row());
    await getUser();

    const where = findUnique.mock.calls[0]?.[0]?.where as { tokenHash: string };
    expect(where.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(where.tokenHash).not.toBe("a-token");
  });

  it("refuses an unknown, an expired, and a deactivated user's session", async () => {
    cookieValue.token = "a-token";

    findUnique.mockResolvedValue(null);
    await expect(getUser()).resolves.toBeNull();

    findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(getUser()).resolves.toBeNull();

    const deactivated = row();
    deactivated.user.status = "INACTIVE";
    findUnique.mockResolvedValue(deactivated);
    await expect(getUser()).resolves.toBeNull();
  });
});

describe("requireUser", () => {
  it("throws UNAUTHENTICATED when signed out", async () => {
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("throws FORBIDDEN for the wrong role", async () => {
    cookieValue.token = "a-token";
    findUnique.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60_000),
      lastSeenAt: new Date(),
      user: {
        id: "user-1",
        role: "SALESPERSON",
        status: "ACTIVE",
        homeBranchId: "branch-1",
        language: "en",
        extraBranches: [],
      },
    });

    await expect(requireUser({ roles: ["ADMIN"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("landingPath", () => {
  it("sends a salesperson to Today and everyone else to the overview", () => {
    expect(landingPath("SALESPERSON")).toBe("/today");
    expect(landingPath("MANAGER")).toBe("/overview");
    expect(landingPath("ADMIN")).toBe("/overview");
  });
});
