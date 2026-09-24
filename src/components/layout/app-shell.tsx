import {
  Bell,
  BellRing,
  CalendarCheck,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
  UserSearch,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { BranchSwitcher } from "@/components/branch/branch-switcher";
import { LanguageSwitcher } from "@/components/language/language-switcher";
import { ManagerShell } from "@/components/layout/manager-shell";
import { PushPrompt } from "@/components/pwa/push-prompt";
import { SalesShell } from "@/components/layout/sales-shell";
import { Avatar } from "@/components/ui/avatar";
import type { NavAction, NavItem } from "@/components/ui/bottom-nav";
import { TopBar } from "@/components/ui/top-bar";
import type { Role } from "@/generated/prisma/client";
import { logoutAndReturnToLogin } from "@/lib/actions/auth";
import { getUser } from "@/lib/auth";
import { unreadCount } from "@/lib/notifications";
import { staffName } from "@/lib/staff-name";

type AppShellProps = {
  role: Role;
  title: string;
  subtitle?: string; // muted line above the title (the date on Today)
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode; // screen buttons in the top bar, before the switchers
  children: ReactNode;
};

// The one shell for every signed-in screen. A salesperson gets the phone column; a
// manager or admin gets the side menu on laptops.
//
// Four nav items at most: a phone's bottom bar has room for four plus Log out. Branches
// and departments therefore live behind Settings, and My profile behind the avatar at
// the top right (M11: the SOW's menu is Today, Customers, Follow-ups, Log out, and the
// follow-up list is "Used by: All").
export async function AppShell({
  role,
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  children,
}: AppShellProps) {
  const t = await getTranslations();
  const salesperson = role === "SALESPERSON";
  const user = await getUser();
  const name = user ? await staffName(user.id) : "";
  const unread = user ? await unreadCount(user.id) : 0;

  const followUps = { href: "/follow-ups", label: t("nav.followUps"), icon: <BellRing /> };
  const items: NavItem[] = salesperson
    ? [
        { href: "/today", label: t("nav.today"), icon: <CalendarCheck /> },
        { href: "/customers", label: t("nav.customers"), icon: <UserSearch /> },
        followUps,
      ]
    : [
        { href: "/overview", label: t("nav.overview"), icon: <LayoutDashboard /> },
        { href: "/staff", label: t("nav.staff"), icon: <Users /> },
        followUps,
        ...(role === "ADMIN"
          ? [{ href: "/settings", label: t("nav.settings"), icon: <Settings /> }]
          : []),
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
      subtitle={subtitle}
      backHref={backHref}
      backLabel={backLabel}
      actions={
        <>
          {actions}
          {!salesperson && <BranchSwitcher />}
          <LanguageSwitcher />
          {user && (
            // M14.06: the bell and its unread count, on every screen.
            <Link
              href="/notifications"
              aria-label={t("notifications.bell", { count: unread })}
              className="relative flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
            >
              <Bell aria-hidden className="size-6" />
              {unread > 0 && (
                <span
                  data-testid="bell-count"
                  className="absolute top-1 right-1 min-w-5 rounded-full bg-danger px-1 text-center text-xs leading-5 font-extrabold text-white"
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          )}
          {name && (
            <Link href="/profile" aria-label={t("nav.profile")} className="ml-1 rounded-full">
              <Avatar name={name} />
            </Link>
          )}
        </>
      }
    />
  );

  // M14.01: asked after login, on whichever screen they land.
  const prompt = user ? (
    <PushPrompt
      publicKey={process.env.VAPID_PUBLIC_KEY ?? ""}
      // The service worker is registered in production builds only (pwa-provider.tsx).
      worker={process.env.NODE_ENV === "production"}
    />
  ) : null;

  if (salesperson) {
    return (
      <SalesShell topBar={topBar} navLabel={t("nav.label")} navItems={items} navAction={logOut}>
        {prompt}
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
      {prompt}
      {children}
    </ManagerShell>
  );
}
