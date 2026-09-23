import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { update: vi.fn() } } }));

const { cookies } = await import("next/headers");
const { getUser } = await import("@/lib/auth");
const { db } = await import("@/lib/db");
const { setLanguage } = await import("@/lib/actions/language");

type SessionUser = NonNullable<Awaited<ReturnType<typeof getUser>>>;

const set = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({ set } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(getUser).mockResolvedValue(null);
});

function signedIn() {
  vi.mocked(getUser).mockResolvedValue({
    id: "u1",
    role: "SALESPERSON",
    homeBranchId: "b1",
    branchIds: ["b1"],
    language: "en",
  } as SessionUser);
}

describe("setLanguage", () => {
  it("remembers the choice for someone who is not signed in yet", async () => {
    // The login screen offers the switch before anyone has a session.
    await expect(setLanguage({ language: "gu" })).resolves.toMatchObject({ ok: true });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith("NEXT_LOCALE", "gu", expect.objectContaining({ path: "/" }));
  });

  it("saves it on the signed-in user as well", async () => {
    signedIn();
    await expect(setLanguage({ language: "hi" })).resolves.toMatchObject({ ok: true });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { language: "hi", updatedById: "u1" },
    });
  });

  it("leaves the cookie alone when the save fails, so the two cannot disagree", async () => {
    signedIn();
    vi.mocked(db.user.update).mockRejectedValue(new Error("database unreachable"));
    await expect(setLanguage({ language: "hi" })).resolves.toMatchObject({ ok: false });
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses a language the app does not have", async () => {
    await expect(setLanguage({ language: "fr" })).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
    expect(set).not.toHaveBeenCalled();
  });
});
