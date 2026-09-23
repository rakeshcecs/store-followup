import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUser: vi.fn() }));
// Outside Next, next-intl/server resolves to its client build and refuses to run.
// The part worth testing is our own callback, so hand it straight back.
vi.mock("next-intl/server", () => ({
  getRequestConfig: (create: unknown) => create,
}));

const { cookies } = await import("next/headers");
const { getUser } = await import("@/lib/auth");
const { resolveLocale } = await import("@/i18n/locale");
const requestConfig = (await import("@/i18n/request")).default;
const { locales } = await import("@/i18n/config");

type SessionUser = NonNullable<Awaited<ReturnType<typeof getUser>>>;

function cookie(value?: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === "NEXT_LOCALE" && value ? { value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function signedInWith(language: "en" | "hi" | "gu") {
  vi.mocked(getUser).mockResolvedValue({
    id: "u1",
    role: "MANAGER",
    homeBranchId: "b1",
    branchIds: ["b1"],
    language,
  } as SessionUser);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUser).mockResolvedValue(null);
});

describe("resolveLocale", () => {
  it("uses the cookie when nobody is signed in", async () => {
    cookie("gu");
    await expect(resolveLocale()).resolves.toBe("gu");
  });

  it("falls back to English with no cookie", async () => {
    cookie(undefined);
    await expect(resolveLocale()).resolves.toBe("en");
  });

  it("ignores a cookie that is not one of our languages", async () => {
    cookie("fr");
    await expect(resolveLocale()).resolves.toBe("en");
  });

  it("prefers the signed-in user's saved language over the cookie", async () => {
    cookie("gu");
    signedInWith("hi");
    await expect(resolveLocale()).resolves.toBe("hi");
  });

  it("falls back to the cookie instead of failing when the database is down", async () => {
    cookie("gu");
    vi.mocked(getUser).mockRejectedValue(new Error("database unreachable"));
    await expect(resolveLocale()).resolves.toBe("gu");
  });
});

describe("the request config", () => {
  it("honours a language asked for explicitly, whatever the cookie says", async () => {
    // What a report or an export does: getTranslations({ locale: user.language }).
    cookie("hi");
    const config = await requestConfig({
      locale: "gu",
      requestLocale: Promise.resolve(undefined),
    });
    expect(config.locale).toBe("gu");
    expect((config.messages as { language: { label: string } }).language.label).toBe("ભાષા");
  });

  it("always reports Indian time", async () => {
    cookie("en");
    const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.timeZone).toBe("Asia/Kolkata");
  });
});

describe("languages", () => {
  it("match the Language column in the database", async () => {
    // A fourth language must never be added to one side only.
    const { Language } = await import("@/generated/prisma/client");
    expect(Object.values(Language).sort()).toEqual([...locales].sort());
  });
});
