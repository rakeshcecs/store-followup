"use client";

import { Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Chrome's install event (not in the standard DOM types).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "server" | "standalone" | "ios" | "other";

function detectPlatform(): Platform {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "standalone";
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOs ? "ios" : "other";
}

const noSubscribe = () => () => {};

// "Install app" help: real Install button on Android/Chrome, Share-menu hint on iPhone,
// nothing when the app is already installed or the browser can't install it.
export function InstallHelp() {
  const t = useTranslations("pwa");
  const platform = useSyncExternalStore(noSubscribe, detectPlatform, (): Platform => "server");
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault(); // show our own button instead of the mini-infobar
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (platform === "server" || platform === "standalone") return null;

  if (installEvent) {
    const install = async () => {
      await installEvent.prompt();
      await installEvent.userChoice;
      setInstallEvent(null); // the event can only be used once
    };
    return (
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-[15px] text-ink-2">{t("installText")}</p>
        <Button onClick={install}>{t("install")}</Button>
      </Card>
    );
  }

  if (platform === "ios") {
    return (
      <Card className="flex items-center gap-3 p-4">
        <Share aria-hidden className="size-6 shrink-0 text-primary" />
        <p className="text-[15px] text-ink-2">{t("iosHint")}</p>
      </Card>
    );
  }

  return null;
}
