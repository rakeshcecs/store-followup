import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Imported inside cookies(), not in the factory: the helper reaches @/lib/session,
// which imports the very module this factory is still building, and eagerly importing
// it there deadlocks the run.
vi.mock("next/headers", () => ({
  cookies: async () => {
    const { sessionCookieStore } = await import("../helpers/session");
    return { ...sessionCookieStore(), set: () => {} };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setLanguage } = await import("@/lib/actions/language");
const { db } = await import("@/lib/db");
const { makeBranch, makeUser, nextMobile } = await import("../helpers/branch-access");
const { signInAs } = await import("../helpers/session");

let mobile: string;
let userId: string;

beforeAll(async () => {
  const branch = await makeBranch();
  mobile = nextMobile();
  const user = await makeUser({ role: "SALESPERSON", homeBranchId: branch.id, mobile });
  userId = user.id;
});

afterAll(() => db.$disconnect());

describe("setLanguage", () => {
  it("saves the choice on the signed-in user", async () => {
    await signInAs(mobile);
    expect((await setLanguage({ language: "gu" })).ok).toBe(true);

    expect((await db.user.findUnique({ where: { id: userId } }))?.language).toBe("gu");
  });

  it("writes no audit entry: this is a screen preference, not a business record", async () => {
    await signInAs(mobile);
    await setLanguage({ language: "hi" });

    const entries = await db.auditLog.findMany({ where: { entityType: "User", entityId: userId } });
    expect(entries).toEqual([]);
  });
});
