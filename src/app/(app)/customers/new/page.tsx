import { Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CustomerForm } from "@/app/(app)/customers/new/customer-form";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { getBranchScope, getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { normalizeMobile } from "@/lib/mobile";
import { ALL_BRANCHES } from "@/lib/permissions";
import { staffBranchWhere } from "@/lib/staff-scope";

// New customer (M05). Reached from the search that found nothing, carrying the number.

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ mobile?: string }>;
}) {
  const user = await requireUser();
  const scope = await getBranchScope(user);
  const branchChoice = await getCurrentBranch(user);
  const { mobile } = await searchParams;
  const t = await getTranslations("customers");

  const [departments, staff, branch] = await Promise.all([
    db.department.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Who this customer can be handed to: the people working in the branch on screen.
    db.user.findMany({
      where: { status: "ACTIVE", ...staffBranchWhere(scope) },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    // The store's own city is the sensible default for the city box (M05.06). An admin
    // looking at every branch at once has no single city, so the box starts empty.
    branchChoice === ALL_BRANCHES
      ? null
      : db.branch.findUnique({ where: { id: branchChoice }, select: { city: true } }),
  ]);

  // A walk-in happened in one shop, so it cannot be filed under "All branches" — the
  // action refuses it too. Saying so here means an admin is not left pressing Save on a
  // form that can never succeed.
  if (branchChoice === ALL_BRANCHES) {
    return (
      <AppShell role={user.role} title={t("new")} backHref="/customers" backLabel={t("back")}>
        <Card>
          <EmptyState icon={Building2} title={t("pickBranch")} text={t("pickBranchText")} />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell role={user.role} title={t("new")} backHref="/customers" backLabel={t("back")}>
      <CustomerForm
        mobile={normalizeMobile(mobile) ?? ""}
        departments={departments}
        staff={staff.map((person) => ({ id: person.id, name: person.fullName }))}
        currentUserId={user.id}
        defaultCity={branch?.city ?? ""}
      />
    </AppShell>
  );
}
