import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

// Placeholder. M12 builds the real dashboard; M02 needs managers and admins to land
// somewhere real after logging in.
export default async function OverviewPage() {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const t = await getTranslations("overview");

  return (
    <AppShell role={user.role} title={t("title")}>
      <Card className="p-4">
        <p className="text-muted-foreground">{t("comingSoon")}</p>
      </Card>
    </AppShell>
  );
}
