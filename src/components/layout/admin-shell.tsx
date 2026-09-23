import { Store } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { BranchSwitcher } from "@/components/branch/branch-switcher";
import { LanguageSwitcher } from "@/components/language/language-switcher";
import { ManagerShell } from "@/components/layout/manager-shell";
import { TopBar } from "@/components/ui/top-bar";
import type { NavItem } from "@/components/ui/bottom-nav";

type AdminShellProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
};

// Admin screens: side menu on laptops, bottom menu on phones, branch and language
// switchers in the top bar. M03 (/staff), M04 (/settings) and M12 (/overview) add
// their nav item here.
async function adminNavItems(): Promise<NavItem[]> {
  const t = await getTranslations("nav");
  return [{ href: "/branches", label: t("branches"), icon: <Store /> }];
}

export async function AdminShell({ title, backHref, backLabel, children }: AdminShellProps) {
  const t = await getTranslations();

  return (
    <ManagerShell
      appTitle={t("app.storeName")}
      navLabel={t("nav.label")}
      navItems={await adminNavItems()}
      topBar={
        <TopBar
          title={title}
          backHref={backHref}
          backLabel={backLabel}
          actions={
            <>
              <BranchSwitcher />
              <LanguageSwitcher />
            </>
          }
        />
      }
    >
      {children}
    </ManagerShell>
  );
}
