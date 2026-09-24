import {
  CalendarCheck,
  LayoutDashboard,
  LogOut,
  Settings,
  User,
  Users,
  UserSearch,
} from "lucide-react";
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
  actions?: ReactNode; // screen buttons in the top bar, before the switchers
  children: ReactNode;
};

// The one shell for every signed-in screen. A salesperson gets the phone column; a
// manager or admin gets the side menu on laptops.
//
// Four nav items at most: a phone's bottom bar has room for four plus Log out. Branches
// and departments therefore live behind Settings, which is also where M04's master lists
// will go. Later modules add /customers (M05) and /follow-ups (M06) for the salesperson.
export async function AppShell({
  role,
  title,
  backHref,
  backLabel,
  actions,
  children,
}: AppShellProps) {
  const t = await getTranslations();
  const salesperson = role === "SALESPERSON";

  const items: NavItem[] = salesperson
    ? [
        { href: "/today", label: t("nav.today"), icon: <CalendarCheck /> },
        { href: "/customers", label: t("nav.customers"), icon: <UserSearch /> },
        { href: "/profile", label: t("nav.profile"), icon: <User /> },
      ]
    : [
        { href: "/overview", label: t("nav.overview"), icon: <LayoutDashboard /> },
        { href: "/staff", label: t("nav.staff"), icon: <Users /> },
        ...(role === "ADMIN"
          ? [{ href: "/settings", label: t("nav.settings"), icon: <Settings /> }]
          : []),
        { href: "/profile", label: t("nav.profile"), icon: <User /> },
      ];

  // A form action, so logging out is a POST and works without JavaScript.
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
          {actions}
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
