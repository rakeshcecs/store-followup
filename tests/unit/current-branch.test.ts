import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { branch: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() } },
}));

const { cookies } = await import("next/headers");
const { db } = await import("@/lib/db");
const { BRANCH_COOKIE, getCurrentBranch, switchableBranches } =
  await import("@/lib/current-branch");
const { ALL_BRANCHES } = await import("@/lib/permissions");
const A = "branch-a";
const B = "branch-b";

type SessionUser = Awaited<ReturnType<typeof import("@/lib/auth").requireUser>>;

const manager: SessionUser = {
  id: "u2",
  role: "MANAGER",
  homeBranchId: A,
  branchIds: [A, B],
  language: "en",
};
const admin: SessionUser = {
  id: "u3",
  role: "ADMIN",
  homeBranchId: A,
  branchIds: [A],
  language: "en",
};

function cookie(value?: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === BRANCH_COOKIE && value ? { value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function branchIsActive(active: boolean) {
  vi.mocked(db.branch.findFirst).mockResolvedValue(active ? ({ id: B } as never) : null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentBranch", () => {
  it("falls back to the home branch when no branch was chosen", async () => {
    cookie(undefined);
    await expect(getCurrentBranch(manager)).resolves.toBe(A);
  });

  it("keeps 'all' for an admin", async () => {
    cookie(ALL_BRANCHES);
    await expect(getCurrentBranch(admin)).resolves.toBe(ALL_BRANCHES);
  });

  it("ignores 'all' for a manager", async () => {
    cookie(ALL_BRANCHES);
    await expect(getCurrentBranch(manager)).resolves.toBe(A);
  });

  it("ignores a branch the user does not belong to", async () => {
    cookie("branch-c");
    await expect(getCurrentBranch(manager)).resolves.toBe(A);
    expect(db.branch.findFirst).not.toHaveBeenCalled();
  });

  it("keeps an allowed, active branch", async () => {
    cookie(B);
    branchIsActive(true);
    await expect(getCurrentBranch(manager)).resolves.toBe(B);
  });

  it("drops a branch that has been deactivated", async () => {
    cookie(B);
    branchIsActive(false);
    await expect(getCurrentBranch(manager)).resolves.toBe(A);
  });
});

describe("switchableBranches", () => {
  it("offers an admin every active branch", async () => {
    vi.mocked(db.branch.findMany).mockResolvedValue([
      { id: B, name: "Beta" },
      { id: A, name: "Alpha" },
    ] as never);

    await expect(switchableBranches(admin)).resolves.toEqual([
      { id: A, name: "Alpha" },
      { id: B, name: "Beta" }, // home branch first, then by name
    ]);
    expect(vi.mocked(db.branch.findMany).mock.calls[0]?.[0]?.where).toEqual({ status: "ACTIVE" });
  });

  it("offers a manager only their own branches", async () => {
    vi.mocked(db.branch.findMany).mockResolvedValue([{ id: A, name: "Alpha" }] as never);

    await switchableBranches(manager);
    expect(vi.mocked(db.branch.findMany).mock.calls[0]?.[0]?.where).toEqual({
      status: "ACTIVE",
      id: { in: [A, B] },
    });
  });
});
