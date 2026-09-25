import type { ReactNode } from "react";
import { SideNav } from "@/components/layout/side-nav";
import { BottomNav, type NavAction, type NavItem } from "@/components/ui/bottom-nav";
import { cn } from "@/lib/utils";

type ManagerShellProps = {
  appTitle: string;
  topBar: ReactNode;
  navLabel: string;
  navItems: NavItem[];
  navAction?: NavAction;
  children: ReactNode;
  className?: string;
};

// Manager/admin screens: side menu on laptops (lg+), bottom menu on phones; content up to 1200px.
export function ManagerShell({
  appTitle,
  topBar,
  navLabel,
  navItems,
  navAction,
  children,
  className,
}: ManagerShellProps) {
  return (
    <div
      data-slot="manager-shell"
      className={cn(
        "flex h-dvh w-full bg-background pt-[env(safe-area-inset-top)] lg:pt-0",
        className,
      )}
    >
      <aside className="hidden w-60 shrink-0 lg:block print:hidden">
        <SideNav label={navLabel} title={appTitle} items={navItems} action={navAction} />
      </aside>
      <div className="flex min-w-0 grow flex-col">
        <div className="mx-auto flex w-full max-w-300 grow flex-col overflow-hidden">
          {topBar}
          <main className="flex grow flex-col gap-5.5 overflow-y-auto px-5 pt-2 pb-6">
            {children}
          </main>
        </div>
        <BottomNav label={navLabel} items={navItems} action={navAction} className="lg:hidden" />
      </div>
    </div>
  );
}
