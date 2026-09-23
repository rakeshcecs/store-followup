import { expect, test } from "@playwright/test";

// The dev sign-in stub is off in a production build (that is the point of it), so the
// admin area must be invisible until M02 adds real login. This proves it ships closed.
test.describe("admin branches", () => {
  test("is not reachable without being signed in", async ({ request }) => {
    for (const path of ["/branches", "/branches/new"]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });
});
