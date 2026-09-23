import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { StaffForm } from "@/app/(app)/staff/staff-form";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import type { BranchScope } from "@/lib/permissions";

// Adding staff is the admin's job alone; a manager reaching this URL gets a 404 from the
// action's own check and never sees the form, because requireUser throws first.
export default async function NewStaffPage() {
  const user = await requireUser();
  if (user.role !== "ADMIN") notFound(); // a manager may read the list, not edit it
  const scope = await getBranchScope(user);
  const t = await getTranslations("staff");

  const [branches, departments] = await Promise.all([
    db.branch.findMany({
      // Only branches this admin is currently looking at, so a new person cannot land in
      // a branch that is not on screen. Branch has a real branchId column, hence branchWhere.
      where: { status: "ACTIVE", ...branchesInScope(scope) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.department.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <AppShell role={user.role} title={t("new")} backHref="/staff" backLabel={t("back")}>
      <StaffForm branches={branches} departments={departments} />
    </AppShell>
  );
}

// The scope lists branch ids, and on Branch itself that column is the primary key, so
// this filters on id rather than on branchId as branchWhere() would.
function branchesInScope(scope: BranchScope) {
  return scope.all ? {} : { id: { in: scope.branchIds } };
}
