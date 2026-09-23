import { getTranslations } from "next-intl/server";
import { MasterList } from "@/app/(admin)/settings/master-lists/master-list";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { branchWhereShared } from "@/lib/permissions";

// Requirement categories (SOW M04.01). These drive the chips on Record visit (M07), so
// the order set here is the order there.
export default async function CategoriesPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const scope = await getBranchScope(user);
  const t = await getTranslations("categories");

  const [items, branches] = await Promise.all([
    db.requirementCategory.findMany({
      // Shared items (branchId null) belong to every branch, so branchWhereShared.
      where: branchWhereShared(scope),
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: {
        id: true,
        nameEn: true,
        nameHi: true,
        nameGu: true,
        active: true,
        branchId: true,
        // What makes Delete available or not: an item any record points at stays.
        _count: { select: { enquiries: true, visits: true } },
      },
    }),
    db.branch.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <AppShell role={user.role} title={t("title")} backHref="/settings" backLabel={t("back")}>
      <MasterList
        kind="category"
        branches={branches}
        items={items.map(({ _count, ...item }) => ({
          ...item,
          usageCount: _count.enquiries + _count.visits,
        }))}
      />
    </AppShell>
  );
}
