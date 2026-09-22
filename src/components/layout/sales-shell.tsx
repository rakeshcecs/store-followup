import type { ReactNode } from "react";
import { BottomNav, type NavAction, type NavItem } from "@/components/ui/bottom-nav";
import { cn } from "@/lib/utils";

type SalesShellProps = {
  topBar: ReactNode;
  navLabel: string;
  navItems: NavItem[];
  navAction?: NavAction;
  children: ReactNode;
  className?: string;
};

// Salesperson screens: phone-width column (max 480px), centred on bigger screens.
export function SalesShell({
  topBar,
  navLabel,
  navItems,
  navAction,
  children,
  className,
}: SalesShellProps) {
  return (
    <div
      data-slot="sales-shell"
      className={cn(
        "mx-auto flex h-dvh w-full max-w-120 flex-col bg-background pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      {topBar}
      <main className="flex grow flex-col gap-5.5 overflow-y-auto px-5 pt-2 pb-6">{children}</main>
      <BottomNav label={navLabel} items={navItems} action={navAction} />
    </div>
  );
}
