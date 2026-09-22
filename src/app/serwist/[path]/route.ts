import { randomUUID } from "node:crypto";
import { createSerwistRoute } from "@serwist/turbopack";

// Serves the service worker at /serwist/sw.js (Serwist's Turbopack integration).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
    globPatterns: [".next/static/**/*.{js,css,woff,woff2,png,svg,ico,webp}", "public/icons/**/*"],
    // The offline page is precached so it shows when a page can't load. New id per build.
    additionalPrecacheEntries: [{ url: "/offline", revision: randomUUID() }],
  },
);
