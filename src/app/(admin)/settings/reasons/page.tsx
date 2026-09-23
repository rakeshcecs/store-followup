import { getTranslations } from "next-intl/server";
import { MasterList } from "@/app/(admin)/settings/master-lists/master-list";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Not-interested reasons (SOW M04.02). No branch column in the schema, so this list is
// always store-wide and the screen shows no branch select.
export default async function ReasonsPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const t = await getTranslations("reasons");

  const items = await db.lostReason.findMany({
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    select: {
      id: true,
      nameEn: true,
      nameHi: true,
      nameGu: true,
      active: true,
      _count: { select: { enquiries: true, visits: true } },
    },
  });

  return (
    <AppShell role={user.role} title={t("title")} backHref="/settings" backLabel={t("back")}>
      <MasterList
        kind="reason"
        branches={[]}
        items={items.map(({ _count, ...item }) => ({
          ...item,
          branchId: null,
          usageCount: _count.enquiries + _count.visits,
        }))}
      />
    </AppShell>
  );
}
