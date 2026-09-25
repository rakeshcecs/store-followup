import { getTranslations } from "next-intl/server";
import { ReportLinks } from "@/app/(app)/reports/report-links";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { reportsFor } from "@/lib/reports/run";

// M13: the reports this person may open. A salesperson sees "My figures" — R2 and R3,
// their own numbers only (M13.03).
export default async function ReportsPage() {
  const user = await requireUser();
  const t = await getTranslations("reports");
  const tNav = await getTranslations("nav");
  const salesperson = user.role === "SALESPERSON";

  return (
    <AppShell
      role={user.role}
      title={salesperson ? t("myTitle") : t("title")}
      backHref={salesperson ? "/profile" : "/overview"}
      backLabel={salesperson ? tNav("profile") : tNav("overview")}
    >
      {salesperson && <p className="text-muted-foreground">{t("ownOnly")}</p>}
      <ReportLinks codes={reportsFor(user).map((def) => def.code)} audit={!salesperson} />
    </AppShell>
  );
}
