"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TopBarProps = {
  title: string;
  subtitle?: string; // a muted line above the title, e.g. the date on Today
  backLabel?: string; // accessible label; back button shows only when given
  backHref?: string; // go here; otherwise browser back
  statusSlot?: ReactNode; // online/offline + sync status (M19)
  actions?: ReactNode; // right-side buttons
  className?: string;
};

// min-w-0 + two lines at most: on a phone a long title ("Reassign customers") wraps
// instead of being cut to a letter or two, and never pushes the page wider than the
// screen.
const titleClass =
  "min-w-0 line-clamp-2 font-heading-style text-[23px] leading-tight wrap-break-word";

const iconButton =
  "flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-black/5";

export function TopBar({
  title,
  subtitle,
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
      // flex-wrap below sm: lets the branch switcher take a line of its own on a phone
      // (see AppShell). Everything else keeps one line: the title has basis-0, so it never
      // pushes a button onto the next line — it gives way instead.
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-1 px-3 pt-4.5 pb-1.5 sm:flex-nowrap",
        className,
      )}
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
      {subtitle ? (
        <div className={cn("min-w-0 grow basis-0", !backLabel && "pl-2")}>
          <p className="text-sm font-semibold text-muted-foreground">{subtitle}</p>
          <h1 className={titleClass}>{title}</h1>
        </div>
      ) : (
        <h1 className={cn("grow basis-0", titleClass, !backLabel && "pl-2")}>{title}</h1>
      )}
      {statusSlot}
      {actions}
    </header>
  );
}
