import { describe, expect, it } from "vitest";
import { isNavigation, isShellAsset } from "@/lib/pwa/cache-rules";
import manifest from "@/app/manifest";

const origin = "https://app.example.in";

function check(path: string, init: RequestInit = {}, sameOrigin = true) {
  const url = new URL(path, sameOrigin ? origin : "https://cdn.other.com");
  return isShellAsset({ url, request: new Request(url, init), sameOrigin });
}

describe("isShellAsset (what the service worker may cache)", () => {
  it.each([
    "/_next/static/chunks/app.js",
    "/_next/static/css/app.css",
    "/_next/static/media/manrope.woff2",
    "/icons/icon-192.png",
  ])("caches app shell file %s", (path) => {
    expect(check(path)).toBe(true);
  });

  it.each([
    "/",
    "/customers/123",
    "/api/health",
    "/api/sync",
    "/customers?_rsc=abc123",
    "/_next/static/chunks/app.js?_rsc=1",
  ])("never caches %s (may hold customer data)", (path) => {
    expect(check(path)).toBe(false);
  });

  it("never caches POST requests (Server Actions)", () => {
    expect(check("/_next/static/chunks/app.js", { method: "POST" })).toBe(false);
    expect(check("/customers", { method: "POST" })).toBe(false);
  });

  it("never caches other origins", () => {
    expect(check("/_next/static/chunks/app.js", {}, false)).toBe(false);
  });
});

describe("isNavigation", () => {
  it("is false for normal fetches", () => {
    expect(isNavigation(new Request(`${origin}/api/health`))).toBe(false);
  });
});

describe("manifest", () => {
  const m = manifest();

  it("opens standalone with the design colours", () => {
    expect(m).toMatchObject({
      display: "standalone",
      start_url: "/",
      theme_color: "#2d3a8c",
      background_color: "#f4f2ee",
      short_name: "Follow-up",
    });
  });

  it("has 192, 512 and maskable icons", () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual([
      "192x192:any",
      "512x512:any",
      "512x512:maskable",
    ]);
  });
});
