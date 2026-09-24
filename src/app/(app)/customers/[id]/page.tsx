import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMobile } from "@/lib/format";

// Placeholder for M06 (Customer profile and history). M05's search screen offers
// "Open history" and its recent list links here, so the route has to exist; M06 replaces
// the body with the profile, the open enquiry and the full timeline.
export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const t = await getTranslations("customers");

  // No branch filter, on purpose: customers are shared across branches (BR-16).
  const customer = await db.customer.findFirst({
    where: { id, active: true },
    select: { name: true, mobile: true },
  });
  if (!customer) notFound();

  return (
    <AppShell role={user.role} title={customer.name} backHref="/customers" backLabel={t("back")}>
      <Card className="flex flex-col gap-1 p-4">
        <p className="font-heading-style text-lg">{customer.name}</p>
        {customer.mobile && (
          <p className="text-muted-foreground">{formatMobile(customer.mobile)}</p>
        )}
        <p className="mt-2 text-muted-foreground">{t("historyComingSoon")}</p>
      </Card>
    </AppShell>
  );
}
