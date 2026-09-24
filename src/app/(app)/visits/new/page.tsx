import { Building2 } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { VisitForm } from "@/app/(app)/visits/new/visit-form";
import { CustomerStrip } from "@/components/customers/customer-strip";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { formatDayDate } from "@/lib/format";
import { activeCategories, activeLostReasons } from "@/lib/master-lists";
import { ALL_BRANCHES } from "@/lib/permissions";

// Record visit (M07). Every role records visits (SOW 3.1), so there is no role check
// beyond being signed in. Reached from M05 right after a new customer is saved, and from
// "Add today's visit" / "Add visit" on the search card and the profile.
export default async function NewVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const user = await requireUser();
  const { customerId } = await searchParams;
  if (!customerId) notFound();
  const t = await getTranslations("visits");
  const locale = (await getLocale()) as Locale;

  // Customers are shared across branches (BR-16); the visit belongs to the branch on
  // screen (M17.04), which the action takes from the same place.
  const customer = await db.customer.findFirst({
    where: { id: customerId, active: true },
    select: { id: true, name: true, assignedTo: { select: { fullName: true } } },
  });
  if (!customer) notFound();

  const shell = (children: ReactNode) => (
    <AppShell
      role={user.role}
      title={t("new")}
      backHref={`/customers/${customer.id}`}
      backLabel={t("back")}
    >
      {children}
    </AppShell>
  );

  // A visit happens in one shop, so it cannot be filed under "All branches"; the action
  // refuses it too. Same answer as M05's new-customer screen.
  const branch = await getCurrentBranch(user);
  if (branch === ALL_BRANCHES) {
    return shell(
      <Card>
        <EmptyState icon={Building2} title={t("pickBranch")} text={t("pickBranchText")} />
      </Card>,
    );
  }

  const [categories, reasons] = await Promise.all([
    activeCategories({ all: false, branchIds: [branch] }, locale),
    activeLostReasons(locale),
  ]);

  return shell(
    <>
      {/* M07.01: the customer, today's date and who looks after them. */}
      <CustomerStrip
        name={customer.name}
        line={t("strip", {
          date: formatDayDate(new Date(), locale),
          name: customer.assignedTo.fullName,
        })}
      />
      <VisitForm
        userId={user.id}
        customerId={customer.id}
        categories={categories.map(({ id, name }) => ({ id, name }))}
        reasons={reasons.map(({ id, name }) => ({ id, name }))}
      />
    </>,
  );
}
