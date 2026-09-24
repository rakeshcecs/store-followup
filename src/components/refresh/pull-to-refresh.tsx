"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";

// How far a finger must pull, in px, before letting go refreshes.
export const PULL_THRESHOLD = 70;

// M11 "Pull down to refresh". An installed PWA has no browser pull-to-refresh, so the
// screen does its own: a pull that starts at the top of the scrolling <main> and goes
// past the threshold calls router.refresh(). Place it first inside the screen.
export function PullToRefresh() {
  const t = useTranslations("refresh");
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, startTransition] = useTransition();

  useEffect(() => {
    const scroller = ref.current?.closest("main");
    if (!scroller) return;
    // Keeps the browser's own pull-to-refresh (a full reload) from firing as well.
    scroller.style.overscrollBehaviorY = "contain";

    let startY: number | null = null;
    let distance = 0;
    const onStart = (event: TouchEvent) => {
      startY = scroller.scrollTop <= 0 ? (event.touches[0]?.clientY ?? null) : null;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      distance = Math.max(0, (event.touches[0]?.clientY ?? startY) - startY);
      setPull(Math.min(distance, PULL_THRESHOLD * 1.5));
    };
    const onEnd = () => {
      if (startY !== null && distance >= PULL_THRESHOLD) {
        startTransition(() => router.refresh());
      }
      startY = null;
      distance = 0;
      setPull(0);
    };

    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: true });
    scroller.addEventListener("touchend", onEnd);
    scroller.addEventListener("touchcancel", onEnd);
    return () => {
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", onEnd);
    };
  }, [router]);

  const label = refreshing ? t("refreshing") : pull >= PULL_THRESHOLD ? t("release") : t("pull");

  return (
    // The negative margin cancels <main>'s gap while nothing is shown.
    <div
      ref={ref}
      role="status"
      className="-mb-5.5 flex items-end justify-center overflow-hidden text-sm font-semibold text-muted-foreground"
      style={{ height: refreshing ? 32 : pull / 2 }}
    >
      {(refreshing || pull > 0) && (
        <span className="flex items-center gap-2 pb-1">
          <RefreshCw
            aria-hidden
            className={cn("size-4", refreshing && "animate-spin")}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          />
          {label}
        </span>
      )}
    </div>
  );
}
