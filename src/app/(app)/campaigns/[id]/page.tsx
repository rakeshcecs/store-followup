import { Check } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelButton } from "@/app/(app)/campaigns/[id]/cancel-button";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { MessageStatusTicks } from "@/components/whatsapp/message-status";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { loadCampaign } from "@/lib/campaigns/list";
import { CAMPAIGN_STATUS_TONE } from "@/lib/campaigns/status";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, formatMobile } from "@/lib/format";
import { localizedName } from "@/lib/localized-name";
import { isAdmin } from "@/lib/permissions";
import { renderBody } from "@/lib/whatsapp/templates";

const PAGE = 50;

// M23: one campaign — what it is, who it went to, and what happened: the message ticks
// and, per customer, a reply, a visit or a sale within 30 days. Every number is read
// from the records, so the results always match them.
export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const t = await getTranslations("campaigns");
  const tFields = await getTranslations("whatsapp.fields");
  const tWhatsApp = await getTranslations("whatsapp");
  const locale = (await getLocale()) as Locale;
  const campaign = await loadCampaign(await getBranchScope(user), id);
  if (!campaign) notFound();

  const { totals, recipients } = campaign.results;
  const pages = Math.max(1, Math.ceil(recipients.length / PAGE));
  const page = Math.min(Math.max(1, Number(pageParam) || 1), pages);
  const shown = recipients.slice((page - 1) * PAGE, page * PAGE);
  const customers = new Map(
    (
      await db.customer.findMany({
        where: { id: { in: shown.map((row) => row.customerId) } },
        select: { id: true, name: true, mobile: true, active: true },
      })
    ).map((customer) => [customer.id, customer]),
  );

  // The filters, in words, for the "Who" card.
  const f = campaign.filters;
  const [categories, department, reason] = await Promise.all([
    f.categoryIds.length
      ? db.requirementCategory.findMany({
          where: { id: { in: f.categoryIds } },
          select: { id: true, nameEn: true, nameHi: true, nameGu: true },
        })
      : [],
    f.departmentId
      ? db.department.findUnique({ where: { id: f.departmentId }, select: { name: true } })
      : null,
    f.lostReasonId
      ? db.lostReason.findUnique({
          where: { id: f.lostReasonId },
          select: { id: true, nameEn: true, nameHi: true, nameGu: true },
        })
      : null,
  ]);
  const day = (value: string) => formatDate(new Date(`${value}T12:00:00.000Z`), locale);
  const range = (from?: string, to?: string) =>
    [from ? day(from) : "…", to ? day(to) : "…"].join(" – ");
  const who: string[] = [];
  if (categories.length)
    who.push(
      `${t("filters.categories")}: ${categories.map((c) => localizedName(c, locale)).join(", ")}`,
    );
  if (department) who.push(`${t("filters.department")}: ${department.name}`);
  if (f.lastVisitFrom || f.lastVisitTo)
    who.push(`${t("filters.lastVisit")}: ${range(f.lastVisitFrom, f.lastVisitTo)}`);
  if (f.bought)
    who.push(
      `${t(f.bought === "yes" ? "filters.boughtYes" : "filters.boughtNo")}${
        f.boughtFrom || f.boughtTo ? `: ${range(f.boughtFrom, f.boughtTo)}` : ""
      }`,
    );
  if (reason) who.push(`${t("filters.lostReason")}: ${localizedName(reason, locale)}`);
  if (f.intent) who.push(`${t("filters.intent")}: ${t(`intent.${f.intent}`)}`);
  if (f.occasionWithinDays) who.push(`${t("filters.occasionWithin")}: ${f.occasionWithinDays}`);

  const rendered = renderBody(
    campaign.templateBody,
    campaign.templateVariables,
    campaign.templateVariables.map((variable) => {
      const value = campaign.variables[variable];
      if (!value) return `{{${variable}}}`;
      return value.kind === "text" ? value.text : `«${tFields(value.field)}»`;
    }),
  );

  const tiles = [
    ["recipients", totals.recipients],
    ["sent", totals.sent],
    ["delivered", totals.delivered],
    ["read", totals.read],
    ["failed", totals.failed],
    ["replied", totals.replied],
    ["visited", totals.visited],
    ["bought", totals.bought],
  ] as const;
  const canCancel =
    campaign.status === "SCHEDULED" && (campaign.branchId !== null || isAdmin(user));
  const pageHref = (to: number) => `/campaigns/${campaign.id}?page=${to}`;

  return (
    <AppShell role={user.role} title={campaign.name} backHref="/campaigns" backLabel={t("back")}>
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <Pill tone={CAMPAIGN_STATUS_TONE[campaign.status]} data-testid="campaign-status">
            {t(`status.${campaign.status}`)}
          </Pill>
          <span className="text-sm text-muted-foreground">
            {campaign.branchName ?? t("allBranches")}
          </span>
        </div>
        <p className="text-[15px]">
          {t("detail.scheduled", { time: formatDateTime(campaign.scheduledAt, locale) })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("detail.createdBy", { name: campaign.createdByName })}
          {campaign.startedAt &&
            ` · ${t("detail.startedAt", { time: formatDateTime(campaign.startedAt, locale) })}`}
          {campaign.finishedAt &&
            ` · ${t("detail.finishedAt", { time: formatDateTime(campaign.finishedAt, locale) })}`}
          {campaign.cancelledAt &&
            ` · ${t("detail.cancelledAt", { time: formatDateTime(campaign.cancelledAt, locale) })}`}
        </p>
        {canCancel && <CancelButton id={campaign.id} />}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-heading-style text-lg">{t("detail.results")}</h2>
        <dl className="grid grid-cols-2 gap-2 text-[15px] sm:grid-cols-4">
          {tiles.map(([key, value]) => (
            <div key={key} className="rounded-xl bg-grey-light p-3" data-testid={`result-${key}`}>
              <dt className="text-sm text-muted-foreground">{t(`results.${key}`)}</dt>
              <dd className="text-2xl font-extrabold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {campaign.counts && (
          <p className="text-sm text-muted-foreground" data-testid="campaign-counts">
            {t("detail.matched", { count: campaign.counts.matched })} ·{" "}
            {t("detail.skipped", {
              noConsent: campaign.counts.noConsent,
              weeklyLimit: campaign.counts.weeklyLimit,
              missingField: campaign.counts.missingField,
            })}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-heading-style text-lg">{t("detail.template")}</h2>
        <p className="text-sm text-muted-foreground">{campaign.templateName}</p>
        <p className="rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed whitespace-pre-line">
          {rendered}
        </p>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-heading-style text-lg">{t("detail.audience")}</h2>
        {who.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.everyone")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[15px]">
            {who.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Card>

      <section className="flex flex-col gap-2.5">
        <h2 className="font-heading-style text-lg">{t("detail.recipients")}</h2>
        {recipients.length === 0 ? (
          <Card className="p-4 text-muted-foreground">{t("detail.noRecipients")}</Card>
        ) : (
          <Card className="shrink-0 overflow-x-auto p-0">
            <table className="w-full text-[14px]" data-testid="recipients-table">
              <thead className="border-b border-border text-left text-[13px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5">{t("columns.customer")}</th>
                  <th className="px-3 py-2.5">{t("columns.status")}</th>
                  <th className="px-3 py-2.5">{t("columns.replied")}</th>
                  <th className="px-3 py-2.5">{t("columns.visited")}</th>
                  <th className="px-3 py-2.5">{t("columns.bought")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const customer = customers.get(row.customerId);
                  const tick = (yes: boolean) =>
                    yes ? <Check aria-label={t("yes")} className="size-4 text-success" /> : null;
                  return (
                    <tr
                      key={row.messageId}
                      className="border-b border-border last:border-0"
                      data-testid="recipient-row"
                    >
                      <td className="px-3 py-2.5">
                        {customer?.active ? (
                          <Link
                            href={`/customers/${customer.id}`}
                            className="font-bold text-primary"
                          >
                            {customer.name}
                          </Link>
                        ) : (
                          <span className="font-bold">{customer?.name ?? ""}</span>
                        )}
                        {customer?.mobile && (
                          <span className="block text-[13px] text-muted-foreground">
                            {formatMobile(customer.mobile)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <MessageStatusTicks
                          status={row.status}
                          label={tWhatsApp(`status.${row.status}`)}
                        />
                      </td>
                      <td className="px-3 py-2.5">{tick(row.replied)}</td>
                      <td className="px-3 py-2.5">{tick(row.visited)}</td>
                      <td className="px-3 py-2.5">{tick(row.bought)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        {pages > 1 && (
          <nav className="flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="font-bold text-primary">
                {t("previous")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-muted-foreground">{t("page", { page, pages })}</span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="font-bold text-primary">
                {t("next")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </AppShell>
  );
}
