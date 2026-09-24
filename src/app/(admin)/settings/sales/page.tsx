import { getTranslations } from "next-intl/server";
import { SalesSettingsForm } from "@/app/(admin)/settings/sales/sales-settings-form";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { billAmountRequired } from "@/lib/settings";

// Settings → Sales (M10, SOW Open point #1). Admin only.
export default async function SalesSettingsPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const t = await getTranslations("salesSettings");
  const tSettings = await getTranslations("settings");

  return (
    <AppShell
      role={user.role}
      title={t("title")}
      backHref="/settings"
      backLabel={tSettings("title")}
    >
      <SalesSettingsForm billAmountRequired={await billAmountRequired()} />
    </AppShell>
  );
}
