import type { MetadataRoute } from "next";

// Store name decided 25 Sep 2026; the logo is still a placeholder (docs/decisions.md).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Deepak Silk Follow-up",
    short_name: "Follow-up",
    description: "Walk-in, follow-up and sales tracking",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#2d3a8c",
    background_color: "#f4f2ee",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
