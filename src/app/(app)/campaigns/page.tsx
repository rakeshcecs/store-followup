import { Megaphone, Plus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { listCampaigns } from "@/lib/campaigns/list";
import { CAMPAIGN_STATUS_TONE } from "@/lib/campaigns/status";
import { getBranchScope } from "@/lib/current-branch";
import { upcomingFestivals } from "@/lib/festivals";
import { formatDate, formatDateTime, isoDate } from "@/lib/format";

const FESTIVALS_SHOWN = 5;

// M23: the campaigns of the branches on screen, newest first, with their results; the
// festivals coming up; and the way to a new one. Managers and admins only.
export default async function CampaignsPage() {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const t = await getTranslations("campaigns");
  const tReports = await getTranslations("reports");
  const locale = (await getLocale()) as Locale;
  const scope = await getBranchScope(user);
  const today = isoDate(new Date());
  const [campaigns, festivals] = await Promise.all([
    listCampaigns(scope),
    upcomingFestivals(scope, today),
  ]);

  return (
    <AppShell role={user.role} title={t("title")} backHref="/reports" backLabel={tReports("title")}>
      <p className="text-sm text-muted-foreground">{t("about")}</p>
      <Button asChild>
        <Link href="/campaigns/new">
          <Plus aria-hidden />
          {t("new")}
        </Link>
      </Button>

      {festivals.length > 0 && (
        <Card className="flex flex-col gap-2 p-3.5" data-testid="upcoming-festivals">
          <h2 className="font-heading-style text-lg">{t("upcoming")}</h2>
          <ul className="flex flex-col gap-1 text-[15px]">
            {festivals.slice(0, FESTIVALS_SHOWN).map((festival) => (
              <li key={festival.id} className="flex justify-between gap-3">
                <span className="font-bold">{festival.name}</span>
                <span className="text-muted-foreground">{formatDate(festival.date, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title={t("empty")} text={t("emptyText")} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                href={`/campaigns/${campaign.id}`}
                data-testid="campaign-row"
                className="flex flex-col gap-1 rounded-xl border border-border bg-card px-3.5 py-3 no-underline hover:bg-black/2"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold">{campaign.name}</span>
                  <Pill tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
                    {t(`status.${campaign.status}`)}
                  </Pill>
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("line", {
                    time: formatDateTime(campaign.scheduledAt, locale),
                    branch: campaign.branchName ?? t("allBranches"),
                    name: campaign.createdByName,
                  })}
                </span>
                {campaign.results.totals.recipients > 0 && (
                  <span className="text-sm" data-testid="campaign-summary">
                    {t("summary", {
                      sent: campaign.results.totals.sent,
                      delivered: campaign.results.totals.delivered,
                      read: campaign.results.totals.read,
                      replied: campaign.results.totals.replied,
                      bought: campaign.results.totals.bought,
                    })}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
