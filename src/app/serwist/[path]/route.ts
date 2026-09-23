import { randomUUID } from "node:crypto";
import { createSerwistRoute } from "@serwist/turbopack";

// Serves the service worker at /serwist/sw.js (Serwist's Turbopack integration).
const serwist = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  globPatterns: [".next/static/**/*.{js,css,woff,woff2,png,svg,ico,webp}", "public/icons/**/*"],
  // The offline page is precached so it shows when a page can't load. New id per build.
  additionalPrecacheEntries: [{ url: "/offline", revision: randomUUID() }],
});

export const { dynamic, dynamicParams, revalidate, generateStaticParams } = serwist;

// In development, hand back a worker that removes itself instead of the real one.
//
// Testing a production build on the same localhost port leaves a service worker behind.
// Back on `npm run dev` it serves files from that build, so pages either die on a missing
// chunk or fall back to the precached offline page — and because nothing of ours reaches
// the browser, nothing of ours can clean it up. A browser always fetches the worker
// script itself from the network, never through the old worker, so this is the one reply
// that is guaranteed to get through.
const KILL_SWITCH = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
`;

export async function GET(request: Request, context: { params: Promise<{ path: string }> }) {
  if (process.env.NODE_ENV !== "production") {
    return new Response(KILL_SWITCH, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "Service-Worker-Allowed": "/",
      },
    });
  }
  return serwist.GET(request, context);
}
