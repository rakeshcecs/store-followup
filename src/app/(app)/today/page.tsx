import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { FindCustomerButton } from "@/components/customers/find-customer-button";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

// The day's walk-ins and follow-ups arrive with M11; the one thing that works here now is
// the way into M05, which is where a walk-in actually starts.
export default async function TodayPage() {
  const user = await requireUser();
  if (user.role !== "SALESPERSON") notFound();
  const t = await getTranslations("today");

  return (
    <AppShell role={user.role} title={t("title")}>
      <FindCustomerButton />
      <Card className="p-4">
        <p className="text-muted-foreground">{t("comingSoon")}</p>
      </Card>
    </AppShell>
  );
}
