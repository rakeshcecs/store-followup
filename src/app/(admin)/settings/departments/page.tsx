import { getTranslations } from "next-intl/server";
import { DepartmentList } from "@/app/(admin)/settings/departments/department-list";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function DepartmentsPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const t = await getTranslations("departments");

  const departments = await db.department.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      // The two counts the SOW wants in the warning before deactivating.
      _count: { select: { users: { where: { status: "ACTIVE" } }, customers: true } },
    },
  });

  return (
    <AppShell role={user.role} title={t("title")} backHref="/settings" backLabel={t("back")}>
      <DepartmentList
        departments={departments.map((department) => ({
          id: department.id,
          name: department.name,
          status: department.status,
          staffCount: department._count.users,
          customerCount: department._count.customers,
        }))}
      />
    </AppShell>
  );
}
