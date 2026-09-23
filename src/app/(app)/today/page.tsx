import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

// Placeholder. M05/M06 fill this with the day's walk-ins and follow-ups; M02 only needs
// the salesperson to land somewhere real, with the guard and the shell already working.
export default async function TodayPage() {
  const user = await requireUser();
  if (user.role !== "SALESPERSON") notFound();
  const t = await getTranslations("today");

  return (
    <AppShell role={user.role} title={t("title")}>
      <Card className="p-4">
        <p className="text-muted-foreground">{t("comingSoon")}</p>
      </Card>
    </AppShell>
  );
}
