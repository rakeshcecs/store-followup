import { Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BranchStatusButton } from "@/app/(admin)/branches/branch-status-button";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser, type RequireUserOptions } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { db } from "@/lib/db";

// People who block a branch from being deactivated: staff whose home branch it is,
// plus managers who have it as an extra branch. Counted per person, not per row.
async function activeStaffByBranch(): Promise<Map<string, number>> {
  const staff = await db.user.findMany({
    where: { status: "ACTIVE" },
    select: { homeBranchId: true, extraBranches: { select: { branchId: true } } },
  });

  const counts = new Map<string, number>();
  for (const person of staff) {
    const branchIds = new Set([
      person.homeBranchId,
      ...person.extraBranches.map((row) => row.branchId),
    ]);
    for (const branchId of branchIds) counts.set(branchId, (counts.get(branchId) ?? 0) + 1);
  }
  return counts;
}

const ADMIN_ONLY: RequireUserOptions = { roles: ["ADMIN"] };

export default async function BranchesPage() {
  // The layout already guards this area; the page asks again because a screen that
  // renders a role-shaped shell needs the role anyway.
  const user = await requireUser(ADMIN_ONLY);
  const t = await getTranslations("branches");
  const [branches, staffCounts] = await Promise.all([
    db.branch.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, city: true, phone: true, status: true },
    }),
    activeStaffByBranch(),
  ]);

  return (
    <AppShell role={user.role} title={t("title")}>
      <Button asChild>
        <Link href="/branches/new">{t("add")}</Link>
      </Button>

      {branches.length === 0 ? (
        <Card className="p-2">
          <EmptyState icon={Store} title={t("empty")} text={t("emptyText")} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {branches.map((branch) => {
            const staffCount = staffCounts.get(branch.id) ?? 0;
            const active = branch.status === "ACTIVE";
            return (
              <li key={branch.id}>
                <Card className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-heading-style text-lg">{branch.name}</p>
                      <p className="text-[15px] text-muted-foreground">
                        {branch.city} · {branch.phone}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("staffCount", { count: staffCount })}
                      </p>
                    </div>
                    <Pill tone={active ? "green" : "grey"}>
                      {active ? t("statusActive") : t("statusInactive")}
                    </Pill>
                  </div>
                  <div className="flex gap-2.5">
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/branches/${branch.id}/edit`}>{t("edit")}</Link>
                    </Button>
                    <BranchStatusButton
                      id={branch.id}
                      status={branch.status}
                      staffCount={staffCount}
                    />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
