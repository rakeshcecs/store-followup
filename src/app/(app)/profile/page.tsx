import { BarChart3, KeyRound, LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { logoutAndReturnToLogin } from "@/lib/actions/auth";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMobile } from "@/lib/format";

export default async function ProfilePage() {
  const user = await requireUser();
  const t = await getTranslations("profile");
  const tRole = await getTranslations("roles");
  const tAuth = await getTranslations("auth");
  const tReports = await getTranslations("reports");

  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      fullName: true,
      mobile: true,
      role: true,
      // Departments carry one name, not one per language (M18.03 covers the lists
      // that do); M03 is where a department gets assigned.
      department: { select: { name: true } },
    },
  });

  const fields = [
    { label: t("fields.name"), value: row.fullName },
    { label: t("fields.mobile"), value: formatMobile(row.mobile) },
    { label: t("fields.role"), value: tRole(row.role) },
    // Departments are master data with a name per language (M18.03); M03 assigns them.
    {
      label: t("fields.department"),
      value: row.department?.name ?? "—",
    },
  ];

  return (
    <AppShell role={user.role} title={t("title")}>
      <Card className="flex flex-col divide-y divide-border">
        {fields.map((field) => (
          <div key={field.label} className="flex items-center justify-between gap-3 px-4 py-3.5">
            <span className="text-sm font-bold text-muted-foreground">{field.label}</span>
            <span className="text-right text-[17px]">{field.value}</span>
          </div>
        ))}
      </Card>

      <div className="flex flex-col gap-2.5">
        {/* M13.03: a salesperson's own figures (R2, R3); managers reach every report from
            the Store overview. */}
        {user.role === "SALESPERSON" && (
          <Button asChild variant="secondary">
            <Link href="/reports">
              <BarChart3 aria-hidden />
              {tReports("myTitle")}
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link href="/profile/pin">
            <KeyRound aria-hidden />
            {t("changePin")}
          </Link>
        </Button>

        {/* Also in the nav bar, but the spec puts it on this screen too. */}
        <form action={logoutAndReturnToLogin} data-nav-action="">
          <Button type="submit" variant="secondary">
            <LogOut aria-hidden />
            {tAuth("logOut")}
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
