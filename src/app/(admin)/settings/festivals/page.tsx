import { getLocale, getTranslations } from "next-intl/server";
import { FestivalList } from "@/app/(admin)/settings/festivals/festival-list";
import { OccasionSettingsForm } from "@/app/(admin)/settings/festivals/occasion-settings-form";
import { AppShell } from "@/components/layout/app-shell";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listFestivals, prefillFestivals } from "@/lib/festivals";
import { formatDate, isoDate } from "@/lib/format";
import { campaignWeeklyLimit, occasionLeadDays } from "@/lib/settings";

// Settings → Festivals and occasions (M23). Admin only: the festival calendar (pre-filled,
// confirmed by the admin), the occasion follow-up lead days and the weekly campaign cap.
export default async function FestivalSettingsPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const t = await getTranslations("festivals");
  const tSettings = await getTranslations("settings");
  const locale = (await getLocale()) as Locale;
  const today = isoDate(new Date());
  const [festivals, branches, leadDays, weeklyLimit] = await Promise.all([
    listFestivals(today),
    db.branch.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    occasionLeadDays(),
    campaignWeeklyLimit(),
  ]);
  const year = Number(today.slice(0, 4));

  return (
    <AppShell
      role={user.role}
      title={t("title")}
      backHref="/settings"
      backLabel={tSettings("title")}
    >
      <section className="flex flex-col gap-3" aria-labelledby="occasions">
        <h2 id="occasions" className="font-heading-style text-lg">
          {t("occasions")}
        </h2>
        <OccasionSettingsForm
          value={{ occasionLeadDays: leadDays, campaignWeeklyLimit: weeklyLimit }}
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="calendar">
        <h2 id="calendar" className="font-heading-style text-lg">
          {t("calendar")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("calendarHint")}</p>
        <FestivalList
          festivals={festivals.map((festival) => ({
            id: festival.id,
            name: festival.name,
            date: isoDate(festival.date),
            dateLabel: formatDate(festival.date, locale),
            branchId: festival.branchId,
            branchName: festival.branchName,
            confirmed: festival.confirmed,
          }))}
          branches={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          canPrefill={prefillFestivals(today).length > 0}
          years={{ year, next: year + 1 }}
        />
      </section>
    </AppShell>
  );
}
