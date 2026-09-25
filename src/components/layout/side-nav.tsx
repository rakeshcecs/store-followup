"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, type NavAction, type NavItem } from "@/components/ui/bottom-nav";
import { cn } from "@/lib/utils";

type SideNavProps = {
  label: string;
  title: string; // app/store name at the top
  items: NavItem[];
  action?: NavAction;
};

const itemClass =
  "flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px] font-bold text-ink-2 hover:bg-primary-light/60 [&_svg]:size-5";

// Laptop side menu for manager/admin screens.
export function SideNav({ label, title, items, action }: SideNavProps) {
  const pathname = usePathname();

  return (
    <nav
      data-slot="side-nav"
      aria-label={label}
      className="flex h-full flex-col gap-1 border-r border-border bg-sidebar p-4"
    >
      <p className="mb-4 px-3 font-heading-style text-xl">{title}</p>
      {items.map(({ href, label: itemLabel, icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(itemClass, active && "bg-primary-light text-primary-hover")}
          >
            <span aria-hidden>{icon}</span>
            {itemLabel}
          </Link>
        );
      })}
      {action && (
        <form action={action.action} className="mt-auto" data-nav-action="">
          <button type="submit" className={cn(itemClass, "w-full")}>
            <span aria-hidden>{action.icon}</span>
            {action.label}
          </button>
        </form>
      )}
    </nav>
  );
}
