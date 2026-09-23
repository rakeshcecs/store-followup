import { getTranslations } from "next-intl/server";
import { BranchForm } from "@/app/(admin)/branches/branch-form";
import { AdminShell } from "@/components/layout/admin-shell";

export default async function NewBranchPage() {
  const t = await getTranslations("branches");

  return (
    <AdminShell title={t("new")} backHref="/branches" backLabel={t("back")}>
      <BranchForm />
    </AdminShell>
  );
}
