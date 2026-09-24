import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Placeholder. M05 ends here — "After saving, the app goes straight to the Record visit
// screen" (M05.10) — and M07 builds the screen itself. Keeping it real now means the
// whole walk-in flow can be walked end to end before M07 exists.
export default async function NewVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await requireUser();
  const { customerId } = await searchParams;
  const t = await getTranslations("visits");

  // Customers are not branch-scoped (BR-16); the visit this screen will create is, and
  // that check belongs to M07's action rather than to a placeholder.
  const customer = customerId
    ? await db.customer.findFirst({
        where: { id: customerId, active: true },
        select: { name: true },
      })
    : null;
  if (customerId && !customer) notFound();

  return (
    <AppShell role={user.role} title={t("new")} backHref="/customers" backLabel={t("back")}>
      <Card className="p-4">
        <p className="text-muted-foreground">
          {customer ? t("comingSoonFor", { name: customer.name }) : t("comingSoon")}
        </p>
      </Card>
    </AppShell>
  );
}
