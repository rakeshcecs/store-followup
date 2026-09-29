import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// VS Code port forwarding (xxxx-3000.inc1.devtunnels.ms) rewrites the browser's Origin to
// localhost:3000 but sends the tunnel host as x-forwarded-host, so Next's CSRF check sees
// two different hosts and refuses every Server Action (login included). This list also
// applies to the production server, so it is set in dev only.
const DEV_TUNNELS = "**.devtunnels.ms";
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (Dockerfile target "web").
  output: "standalone",
  // Dev only: lets a phone on the same WiFi (and a trycloudflare or VS Code tunnel, for the
  // microphone, which needs HTTPS) load the dev scripts. No effect on the production build.
  allowedDevOrigins: ["192.168.*.*", "*.trycloudflare.com", DEV_TUNNELS],
  ...(isDev && { experimental: { serverActions: { allowedOrigins: ["localhost:3000"] } } }),
  // M13 exports. pdfkit reads its own data files from its package folder at run time, so
  // neither it nor exceljs may be bundled; and the PDF fonts are read from node_modules,
  // so the standalone image must carry them.
  serverExternalPackages: ["pdfkit", "exceljs"],
  outputFileTracingIncludes: {
    "/reports/**": ["./node_modules/@fontsource/noto-sans*/files/*-{400,700}-normal.woff"],
  },
  async headers() {
    // Browsers must always check for a new service worker.
    return [{ source: "/serwist/:path*", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
};

export default withSerwist(withNextIntl(nextConfig));
