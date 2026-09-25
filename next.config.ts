import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (Dockerfile target "web").
  output: "standalone",
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
