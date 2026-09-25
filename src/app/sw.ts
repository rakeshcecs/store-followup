/// <reference lib="webworker" />
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { isNavigation, isShellAsset } from "@/lib/pwa/cache-rules";
import { SYNC_TAG, syncOutbox } from "@/lib/offline/sync";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A new version waits until the app is next opened (all windows closed), never mid-entry.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: isShellAsset,
      handler: new CacheFirst({
        cacheName: "app-shell",
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
    // Everything else (pages, RSC, /api, Server Actions) always goes to the network.
    { matcher: () => true, handler: new NetworkOnly() },
  ],
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => isNavigation(request) }],
  },
});

serwist.addEventListeners();

// M14: a reminder from the worker (src/lib/push.ts sends { title, body, link, tag }).
// The tag is the notification id, so a push delivered twice shows once.
self.addEventListener("push", (event) => {
  const data = (event.data?.json() ?? {}) as {
    title?: string;
    body?: string;
    link?: string;
    tag?: string;
  };
  event.waitUntil(
    self.registration.showNotification(data.title ?? "", {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link: data.link ?? "/" },
    }),
  );
});

// M14.05: tapping opens the matching screen — in the app window if one is open.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data as { link?: string } | null)?.link ?? "/";
  const url = new URL(link, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// M19: Background Sync. A form saved offline asks for this tag; the browser fires it once
// the phone is online again, even if the app was closed in between. Failing while still
// offline makes the browser try again later.
self.addEventListener("sync", (event) => {
  const sync = event as ExtendableEvent & { tag?: string };
  if (sync.tag !== SYNC_TAG) return;
  sync.waitUntil(
    syncOutbox().then((summary) => {
      if (summary.state === "offline") throw new Error("still offline");
    }),
  );
});
