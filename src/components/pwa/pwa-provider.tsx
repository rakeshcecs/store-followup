"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import { useEffect, type ReactNode } from "react";

const isProduction = process.env.NODE_ENV === "production";

// Registers the service worker in production builds only. In development it also clears out
// anything left over from testing a production build on the same localhost port: both the
// registration and its caches, because unregistering alone leaves the cached files behind
// and the next load fails with "Failed to fetch" on chunks that no longer exist.
export function PwaProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (isProduction || !("serviceWorker" in navigator)) return;

    void (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));

      if (!("caches" in window)) return;
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    })();
  }, []);

  // Not rendered at all in development. `disable` only stops the registration; the provider
  // still patches history.pushState and — with its own default reloadOnOnline — listens for
  // the browser's "online" event and calls location.reload(). A DevTools throttling toggle,
  // a WiFi blip or waking the laptop then reloads the page on its own, which looks like the
  // app reopening itself. Nothing of the provider is useful without a worker to talk to.
  if (!isProduction) return <>{children}</>;

  // reloadOnOnline off in production too: staff fill visit and sale forms on mobile data,
  // and a two-second drop must not throw away what they have typed. OnlineStatus already
  // tells them the connection came back.
  return (
    <SerwistProvider swUrl="/serwist/sw.js" reloadOnOnline={false}>
      {children}
    </SerwistProvider>
  );
}
