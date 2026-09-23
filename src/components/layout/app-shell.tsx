import { CalendarCheck, LayoutDashboard, LogOut, Store, User } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { BranchSwitcher } from "@/components/branch/branch-switcher";
import { LanguageSwitcher } from "@/components/language/language-switcher";
import { ManagerShell } from "@/components/layout/manager-shell";
import { SalesShell } from "@/components/layout/sales-shell";
import type { NavAction, NavItem } from "@/components/ui/bottom-nav";
import { TopBar } from "@/components/ui/top-bar";
import type { Role } from "@/generated/prisma/client";
import { logoutAndReturnToLogin } from "@/lib/actions/auth";

type AppShellProps = {
  role: Role;
  title: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
};

// The signed-in shell for every screen outside the admin area. A salesperson gets the
// phone column; a manager or admin gets the side menu on laptops. Later modules add
// their own nav items here: M03 (/staff), M05 (/customers), M06 (/follow-ups).
export async function AppShell({ role, title, backHref, backLabel, children }: AppShellProps) {
  const t = await getTranslations();
  const salesperson = role === "SALESPERSON";

  const items: NavItem[] = salesperson
    ? [
        { href: "/today", label: t("nav.today"), icon: <CalendarCheck /> },
        { href: "/profile", label: t("nav.profile"), icon: <User /> },
      ]
    : [
        { href: "/overview", label: t("nav.overview"), icon: <LayoutDashboard /> },
        ...(role === "ADMIN"
          ? [{ href: "/branches", label: t("nav.branches"), icon: <Store /> }]
          : []),
        { href: "/profile", label: t("nav.profile"), icon: <User /> },
      ];

  // A form action, so logging out is a POST and survives a browser with no JavaScript.
  const logOut: NavAction = {
    label: t("auth.logOut"),
    icon: <LogOut />,
    action: logoutAndReturnToLogin,
  };

  const topBar = (
    <TopBar
      title={title}
      backHref={backHref}
      backLabel={backLabel}
      actions={
        <>
          {!salesperson && <BranchSwitcher />}
          <LanguageSwitcher />
        </>
      }
    />
  );

  if (salesperson) {
    return (
      <SalesShell topBar={topBar} navLabel={t("nav.label")} navItems={items} navAction={logOut}>
        {children}
      </SalesShell>
    );
  }

  return (
    <ManagerShell
      appTitle={t("app.storeName")}
      topBar={topBar}
      navLabel={t("nav.label")}
      navItems={items}
      navAction={logOut}
    >
      {children}
    </ManagerShell>
  );
}
