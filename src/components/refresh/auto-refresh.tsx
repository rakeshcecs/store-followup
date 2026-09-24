"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const REFRESH_EVERY_MS = 60_000;

// M11: counts and lists refresh every 60 seconds while the screen is open. Only while the
// tab is visible — a phone in a pocket should not keep asking — and once more when it
// comes back, so a salesperson who switches from WhatsApp sees what changed meanwhile.
// router.refresh() re-renders the server component; nothing is cached on the phone.
export function AutoRefresh({ everyMs = REFRESH_EVERY_MS }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = setInterval(() => router.refresh(), everyMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, everyMs]);

  return null;
}
