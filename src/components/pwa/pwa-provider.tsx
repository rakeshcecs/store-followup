"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import { useEffect, type ReactNode } from "react";

const isProduction = process.env.NODE_ENV === "production";

// Registers the service worker in production builds only. In development it also removes any
// service worker left over from testing a production build on the same localhost port,
// so it can't serve stale files.
export function PwaProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (isProduction || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister())));
  }, []);

  return (
    <SerwistProvider swUrl="/serwist/sw.js" disable={!isProduction}>
      {children}
    </SerwistProvider>
  );
}
