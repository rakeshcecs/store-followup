"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Icons are elements (e.g. <House />) so server layouts can pass them to these client components.
export type NavItem = { href: string; label: string; icon: ReactNode };
// Runs as a form action, so a Server Action (e.g. log out) can be passed straight in.
export type NavAction = { label: string; icon: ReactNode; action: () => void | Promise<void> };

type BottomNavProps = {
  label: string; // accessible name, e.g. "Main"
  items: NavItem[];
  action?: NavAction; // e.g. Log out, shown last
  className?: string;
};

const tabClass =
  "flex min-h-13 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold text-muted-foreground [&_svg]:size-6";

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ label, items, action, className }: BottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      data-slot="bottom-nav"
      aria-label={label}
      className={cn(
        "flex shrink-0 border-t border-border bg-card px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+12px)] print:hidden",
        className,
      )}
    >
      {items.map(({ href, label: itemLabel, icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(tabClass, active && "text-primary")}
          >
            <span aria-hidden>{icon}</span>
            {itemLabel}
          </Link>
        );
      })}
      {action && (
        <form action={action.action} className="flex flex-1" data-nav-action="">
          <button type="submit" className={tabClass}>
            <span aria-hidden>{action.icon}</span>
            {action.label}
          </button>
        </form>
      )}
    </nav>
  );
}
