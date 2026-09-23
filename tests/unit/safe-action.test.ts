import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { requireUser } = await import("@/lib/auth");
const { logger } = await import("@/lib/logger");
const { AppError } = await import("@/lib/errors");
const { safeAction } = await import("@/lib/safe-action");

const schema = z.object({ mobile: z.string().regex(/^[6-9]\d{9}$/) });
const user = {
  id: "u1",
  role: "MANAGER" as const,
  homeBranchId: "b1",
  branchIds: ["b1"],
  language: "en" as const,
};

beforeEach(() => {
  vi.mocked(requireUser).mockReset().mockResolvedValue(user);
  vi.mocked(logger.error).mockReset();
});

describe("safeAction", () => {
  it("returns ok with handler data for valid input", async () => {
    const action = safeAction({
      name: "test",
      schema,
      auth: { roles: ["MANAGER"] },
      handler: async (input, ctx) => ({ mobile: input.mobile, userId: ctx.user.id }),
    });
    await expect(action({ mobile: "9876543210" })).resolves.toEqual({
      ok: true,
      data: { mobile: "9876543210", userId: "u1" },
    });
    expect(requireUser).toHaveBeenCalledWith({ roles: ["MANAGER"] });
  });

  it("returns VALIDATION with the field for bad input, without calling the handler", async () => {
    const handler = vi.fn();
    const action = safeAction({ name: "test", schema, auth: false, handler });
    await expect(action({ mobile: "12345" })).resolves.toEqual({
      ok: false,
      code: "VALIDATION",
      message: "errors.validation",
      field: "mobile",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips the user check for public actions", async () => {
    const action = safeAction({ name: "test", schema, auth: false, handler: async () => "done" });
    await expect(action({ mobile: "9876543210" })).resolves.toEqual({ ok: true, data: "done" });
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("returns UNAUTHENTICATED when nobody is signed in", async () => {
    vi.mocked(requireUser).mockRejectedValue(new AppError("UNAUTHENTICATED"));
    const handler = vi.fn();
    const action = safeAction({ name: "test", schema, auth: {}, handler });
    await expect(action({ mobile: "9876543210" })).resolves.toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes AppError code, message and field through", async () => {
    const action = safeAction({
      name: "test",
      schema,
      auth: {},
      handler: async () => {
        throw new AppError("RULE", { message: "errors.billDateFuture", field: "billDate" });
      },
    });
    await expect(action({ mobile: "9876543210" })).resolves.toEqual({
      ok: false,
      code: "RULE",
      message: "errors.billDateFuture",
      field: "billDate",
    });
  });

  it("maps a Prisma unique violation (P2002) to CONFLICT", async () => {
    const action = safeAction({
      name: "test",
      schema,
      auth: {},
      handler: async () => {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      },
    });
    await expect(action({ mobile: "9876543210" })).resolves.toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
  });

  it("hides unknown errors as INTERNAL and logs them without the input", async () => {
    const action = safeAction({
      name: "saveCustomer",
      schema,
      auth: {},
      handler: async () => {
        throw new Error("db exploded");
      },
    });
    await expect(action({ mobile: "9876543210" })).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
      message: "errors.internal",
      field: undefined,
    });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("9876543210");
  });
});
