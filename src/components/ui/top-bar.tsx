"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TopBarProps = {
  title: string;
  backLabel?: string; // accessible label; back button shows only when given
  backHref?: string; // go here; otherwise browser back
  statusSlot?: ReactNode; // online/offline + sync status (M19)
  actions?: ReactNode; // right-side buttons
  className?: string;
};

const iconButton =
  "flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-black/5";

export function TopBar({
  title,
  backLabel,
  backHref,
  statusSlot,
  actions,
  className,
}: TopBarProps) {
  const router = useRouter();

  return (
    <header
      data-slot="top-bar"
      className={cn("flex shrink-0 items-center gap-1 px-3 pt-4.5 pb-1.5", className)}
    >
      {backLabel &&
        (backHref ? (
          <Link href={backHref} aria-label={backLabel} className={iconButton}>
            <ArrowLeft aria-hidden className="size-6" />
          </Link>
        ) : (
          <button
            type="button"
            aria-label={backLabel}
            onClick={() => router.back()}
            className={iconButton}
          >
            <ArrowLeft aria-hidden className="size-6" />
          </button>
        ))}
      <h1 className={cn("grow font-heading-style text-[23px]", !backLabel && "pl-2")}>{title}</h1>
      {statusSlot}
      {actions}
    </header>
  );
}
