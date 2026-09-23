import { getTranslations } from "next-intl/server";
import { BranchForm } from "@/app/(admin)/branches/branch-form";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser, type RequireUserOptions } from "@/lib/auth";

const ADMIN_ONLY: RequireUserOptions = { roles: ["ADMIN"] };

export default async function NewBranchPage() {
  const user = await requireUser(ADMIN_ONLY);
  const t = await getTranslations("branches");

  return (
    <AppShell role={user.role} title={t("new")} backHref="/branches" backLabel={t("back")}>
      <BranchForm />
    </AppShell>
  );
}
