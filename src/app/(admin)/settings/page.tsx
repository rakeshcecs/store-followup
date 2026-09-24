import { Building2, ChevronRight, ListChecks, Receipt, Tags, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

// Admin-only settings hub. A phone's bottom bar holds four items, so branches and
// departments live behind this one rather than each taking a slot. M04 adds requirement
// categories and not-interested reasons to the same list.
export default async function SettingsPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const t = await getTranslations("settings");

  const items = [
    { href: "/branches", label: t("branches"), text: t("branchesText"), icon: Building2 },
    {
      href: "/settings/departments",
      label: t("departments"),
      text: t("departmentsText"),
      icon: Users,
    },
    { href: "/settings/categories", label: t("categories"), text: t("categoriesText"), icon: Tags },
    { href: "/settings/reasons", label: t("reasons"), text: t("reasonsText"), icon: ListChecks },
    { href: "/settings/sales", label: t("sales"), text: t("salesText"), icon: Receipt },
  ];

  return (
    <AppShell role={user.role} title={t("title")}>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.href}>
            <Card>
              <Link href={item.href} className="flex items-center gap-3 p-4">
                <item.icon aria-hidden className="size-6 shrink-0 text-primary" />
                <span className="min-w-0 grow">
                  <span className="block font-heading-style text-lg">{item.label}</span>
                  <span className="block text-sm text-muted-foreground">{item.text}</span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
