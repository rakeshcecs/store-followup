"use client";

import { Wifi, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";

// Goes in TopBar's statusSlot. M19 adds the pending-sync count next to it.
export function OnlineStatus({ className }: { className?: string }) {
  const online = useOnline();
  const t = useTranslations("status");

  return (
    <span
      role="status"
      className={cn(
        "flex items-center gap-1 px-2 text-xs font-bold",
        online ? "text-success" : "text-danger",
        className,
      )}
    >
      {online ? (
        <Wifi aria-hidden className="size-4" />
      ) : (
        <WifiOff aria-hidden className="size-4" />
      )}
      {online ? t("online") : t("offline")}
    </span>
  );
}
