import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Placeholder. The customer profile's "Sale done" button (M06.03) lands here, and M10 builds
// the screen itself. Keeping the route real means the profile has no dead button.
export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await requireUser();
  const { customerId } = await searchParams;
  const t = await getTranslations("sales");

  // Customers are not branch-scoped (BR-16); the record this screen will create is, and
  // that check belongs to M10's action rather than to a placeholder.
  const customer = customerId
    ? await db.customer.findFirst({
        where: { id: customerId, active: true },
        select: { id: true, name: true },
      })
    : null;
  if (customerId && !customer) notFound();

  return (
    <AppShell
      role={user.role}
      title={t("new")}
      backHref={customer ? `/customers/${customer.id}` : "/customers"}
      backLabel={t("back")}
    >
      <Card className="p-4">
        <p className="text-muted-foreground">
          {customer ? t("comingSoonFor", { name: customer.name }) : t("comingSoon")}
        </p>
      </Card>
    </AppShell>
  );
}
