import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BranchForm } from "@/app/(admin)/branches/branch-form";
import { AdminShell } from "@/components/layout/admin-shell";
import { db } from "@/lib/db";

export default async function EditBranchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    <AdminShell
      title={t("editOne", { name: branch.name })}
      backHref="/branches"
      backLabel={t("back")}
    >
      <BranchForm branch={branch} />
    </AdminShell>
  );
}
