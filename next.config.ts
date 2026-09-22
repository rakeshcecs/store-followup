import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (Dockerfile target "web").
  output: "standalone",
  async headers() {
    // Browsers must always check for a new service worker.
    return [{ source: "/serwist/:path*", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
};

export default withSerwist(withNextIntl(nextConfig));
