import { afterEach, describe, expect, it, vi } from "vitest";
import { reachServer } from "@/lib/reach-server";

// M01.05: a save that cannot reach the server comes back as a message, not a crash.
describe("reachServer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes a result through", async () => {
    const ok = { ok: true as const, data: 1 };
    await expect(reachServer(Promise.resolve(ok))).resolves.toBe(ok);
  });

  it("turns a failed fetch into the offline message", async () => {
    await expect(reachServer(Promise.reject(new TypeError("Failed to fetch")))).resolves.toEqual({
      ok: false,
      code: "OFFLINE",
      message: "errors.offline",
    });
  });

  it("turns any failure while the phone is offline into the offline message", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(reachServer(Promise.reject(new Error("aborted")))).resolves.toMatchObject({
      code: "OFFLINE",
    });
  });

  it("does not hide a real bug while online", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    await expect(reachServer(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});
