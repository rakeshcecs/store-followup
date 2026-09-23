import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BranchForm } from "@/app/(admin)/branches/branch-form";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser, type RequireUserOptions } from "@/lib/auth";
import { db } from "@/lib/db";

const ADMIN_ONLY: RequireUserOptions = { roles: ["ADMIN"] };

export default async function EditBranchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(ADMIN_ONLY);
  const t = await getTranslations("branches");

  const branch = await db.branch.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      phone: true,
      gstNumber: true,
      openingHours: true,
    },
  });
  if (!branch) notFound();

  return (
    <AppShell
      role={user.role}
      title={t("editOne", { name: branch.name })}
      backHref="/branches"
      backLabel={t("back")}
    >
      <BranchForm branch={branch} />
    </AppShell>
  );
}
