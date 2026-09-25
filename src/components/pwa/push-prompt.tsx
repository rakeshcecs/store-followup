"use client";

import { BellRing, Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { detectPlatform } from "@/components/pwa/install-help";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { subscribePush } from "@/lib/actions/notifications";
import { keyBytes, type PromptState, shouldAsk, snooze } from "@/lib/push-prompt";

const STATE_KEY = "push-prompt";
const SYNCED_KEY = "push-synced";

// Browser storage can be missing or throw (private mode); the card then simply asks.
function readState(): PromptState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as PromptState) : null;
  } catch {
    return null;
  }
}
function writeState(state: PromptState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // nothing to keep; the card may ask again next time
  }
}

// Saves this device's subscription on the server, once per browser session.
async function syncSubscription(registration: ServiceWorkerRegistration, publicKey: string) {
  try {
    if (sessionStorage.getItem(SYNCED_KEY)) return;
  } catch {
    // no sessionStorage: sync every time, it is an upsert
  }
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.["p256dh"] || !json.keys["auth"]) return;
  const result = await subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys["p256dh"], auth: json.keys["auth"] },
  });
  if (result.ok) {
    try {
      sessionStorage.setItem(SYNCED_KEY, "1");
    } catch {
      // fine
    }
  }
}

// Push needs an *active* service worker. Right after login it is often still
// installing — precaching the app shell can take well over ten seconds on a phone — and
// subscribe() then fails with "no active Service Worker". So wait for `ready`, which
// settles once one is active. Only where a worker exists at all: in development there is
// none (src/components/pwa/pwa-provider.tsx) and `ready` would never settle.

type View = "hidden" | "ask" | "ios";

// M14.01: after login, a short explanation first, then the browser's own question. On an
// iPhone that has not installed the app, push cannot work (Apple), so it shows the
// install steps instead (M14.07). Nothing shows without VAPID keys or a service worker
// (development), and nothing once the person has answered the browser.
export function PushPrompt({ publicKey, worker }: { publicKey: string; worker: boolean }) {
  const t = useTranslations("notifications.permission");
  const [view, setView] = useState<View>("hidden");

  useEffect(() => {
    if (!publicKey || !worker) return;
    let cancelled = false;
    void (async () => {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        if (detectPlatform() === "ios" && shouldAsk(readState(), Date.now()) && !cancelled) {
          setView("ios");
        }
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      if (cancelled) return;
      if (Notification.permission === "granted") {
        await syncSubscription(registration, publicKey);
      } else if (Notification.permission === "default" && shouldAsk(readState(), Date.now())) {
        setView("ask");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, worker]);

  if (view === "hidden") return null;

  const notNow = () => {
    writeState(snooze(readState(), Date.now()));
    setView("hidden");
  };

  const allow = async () => {
    setView("hidden");
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await syncSubscription(await navigator.serviceWorker.ready, publicKey);
    }
  };

  if (view === "ios") {
    return (
      <Card
        className="flex flex-col gap-3 p-4 print:hidden"
        role="region"
        aria-label={t("iosTitle")}
      >
        <div className="flex items-start gap-3">
          <Share aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
          <p className="text-[15px] text-ink-2">{t("ios")}</p>
        </div>
        <Button variant="secondary" onClick={notNow}>
          {t("notNow")}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4 print:hidden" role="region" aria-label={t("title")}>
      <div className="flex items-start gap-3">
        <BellRing aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
        <p className="text-[15px] text-ink-2">{t("text")}</p>
      </div>
      <div className="flex gap-2.5">
        <Button className="grow" onClick={allow}>
          {t("allow")}
        </Button>
        <Button variant="secondary" className="grow" onClick={notNow}>
          {t("notNow")}
        </Button>
      </div>
    </Card>
  );
}
