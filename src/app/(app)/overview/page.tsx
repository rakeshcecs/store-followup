import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { FindCustomerButton } from "@/components/customers/find-customer-button";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

// M12 builds the real dashboard. Until then this is also how a manager or admin reaches
// the customer search, which the SOW marks "Used by: All".
export default async function OverviewPage() {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const t = await getTranslations("overview");

  return (
    <AppShell role={user.role} title={t("title")}>
      <FindCustomerButton />
      <Card className="p-4">
        <p className="text-muted-foreground">{t("comingSoon")}</p>
      </Card>
    </AppShell>
  );
}
