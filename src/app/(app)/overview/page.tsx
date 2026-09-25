import { AlertTriangle, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PeriodPicker } from "@/app/(app)/overview/period-picker";
import { ReportLinks } from "@/app/(app)/reports/report-links";
import { FindCustomerButton } from "@/components/customers/find-customer-button";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/current-branch";
import {
  loadAlerts,
  loadOverview,
  OVERDUE_WARN,
  type AlertFollowUp,
  type PersonRow,
} from "@/lib/dashboard";
import { parsePeriod } from "@/lib/dashboard-period";
import { reportsFor } from "@/lib/reports/run";
import { addDays, dayForDisplay } from "@/lib/follow-up-dates";
import { formatDate, formatNumber, isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// M12: the Store overview (Manager, Admin) for the branches in the switcher. Everything
// is counted in src/lib/dashboard.ts, which M13's reports reuse.
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const t = await getTranslations("overview");
  const tRoles = await getTranslations("roles");
  const tReports = await getTranslations("reports");
  const locale = (await getLocale()) as Locale;
  const scope = await getBranchScope(user);

  // One clock reading, so "today" cannot differ between the tiles and the alerts.
  const today = isoDate(new Date());
  const { period, range } = parsePeriod(await searchParams, today);
  const [data, alerts] = await Promise.all([
    loadOverview(scope, range, today, locale),
    loadAlerts(scope, today),
  ]);
  const n = (value: number) => formatNumber(value, locale);
  const day = (value: string) => formatDate(dayForDisplay(value), locale);

  return (
    <AppShell role={user.role} title={t("title")} subtitle={tRoles(user.role)}>
      <FindCustomerButton />
      <PeriodPicker period={period} range={range} />
      {range.from !== range.to && (
        <p className="-mt-2 text-sm text-muted-foreground" data-testid="period-range">
          {day(range.from)} – {day(range.to)}
        </p>
      )}

      {/* 2 columns on a phone; the five in one row on a laptop. */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        <Tile
          id="visited"
          value={n(data.visited.total)}
          label={t("tiles.visited")}
          sub={t("tiles.visitedSub", { new: data.visited.new, existing: data.visited.existing })}
        />
        <Tile
          id="sales"
          value={n(data.sales.total)}
          label={t("tiles.sales")}
          sub={t("tiles.salesSub", { count: data.sales.fromFollowUps })}
          tone="success"
        />
        <Tile
          id="due"
          value={n(data.due.total)}
          label={t("tiles.due")}
          sub={t("tiles.dueSub", { count: data.due.done })}
        />
        <Tile
          id="overdue"
          value={n(data.overdue)}
          label={t("tiles.overdue")}
          sub={data.overdue > 0 ? t("tiles.overdueSub") : t("tiles.overdueNone")}
          tone="danger"
        />
        <Tile
          id="lost"
          value={n(data.notInterested.total)}
          label={t("tiles.notInterested")}
          sub={
            data.notInterested.topReason
              ? t("tiles.topReason", { reason: data.notInterested.topReason })
              : t("tiles.noReason")
          }
        />
      </div>
      {data.conversionPercent !== null && (
        <p className="-mt-2 text-sm text-muted-foreground" data-testid="conversion">
          {t("conversion", { percent: data.conversionPercent })}
        </p>
      )}

      <Section title={t("people.title")}>
        {data.people.length === 0 ? (
          <Card className="p-4 text-muted-foreground">{t("people.empty")}</Card>
        ) : (
          <PeopleTable people={data.people} />
        )}
      </Section>

      <Section title={t("alerts.title")}>
        <AlertCard
          title={t("alerts.notReachable", { count: alerts.notReachable.count })}
          rows={alerts.notReachable.rows}
          more={alerts.notReachable.count - alerts.notReachable.rows.length}
          detail={(row) => t("alerts.missedCalls", { count: row.notReachableCount })}
          data-testid="alert-not-reachable"
        />
        <AlertCard
          title={t("alerts.longOverdue", { count: alerts.longOverdue.count })}
          rows={alerts.longOverdue.rows}
          more={alerts.longOverdue.count - alerts.longOverdue.rows.length}
          // The list's "to" is inclusive; more than 3 days late means due before `before`.
          moreHref={`/follow-ups?tab=overdue&to=${addDays(alerts.longOverdue.before, -1)}`}
          detail={(row) => t("alerts.dueOn", { date: formatDate(row.dueDate, locale) })}
          data-testid="alert-long-overdue"
        />
        {alerts.inactiveStaff.length > 0 && (
          <Card
            className="flex flex-col gap-2 border-danger-light p-4"
            data-testid="alert-inactive"
          >
            <p className="flex items-center gap-2 font-bold text-danger">
              <AlertTriangle aria-hidden className="size-5" />
              {t("alerts.inactiveStaff")}
            </p>
            {alerts.inactiveStaff.map((person) => (
              <Link
                key={person.id}
                href={`/staff/reassign?from=${person.id}`}
                className="flex items-center justify-between gap-3 text-[15px]"
              >
                <span>
                  <b>{person.name}</b>{" "}
                  <span className="text-muted-foreground">
                    {t("alerts.pendingCount", { count: person.followUps })}
                  </span>
                </span>
                <span className="font-bold text-primary">{t("alerts.reassign")}</span>
              </Link>
            ))}
          </Card>
        )}
        {alerts.notReachable.count === 0 &&
          alerts.longOverdue.count === 0 &&
          alerts.inactiveStaff.length === 0 && (
            <Card className="p-4 text-muted-foreground">{t("alerts.none")}</Card>
          )}
      </Section>

      {/* M12.05: links to all reports (M13). */}
      <Section title={tReports("title")}>
        <ReportLinks codes={reportsFor(user).map((def) => def.code)} audit />
      </Section>
    </AppShell>
  );
}

function Tile({
  id,
  value,
  label,
  sub,
  tone,
}: {
  id: string;
  value: string;
  label: string;
  sub: string;
  tone?: "danger" | "success";
}) {
  return (
    <Card
      className={cn("flex flex-col gap-0.5 p-3.5", tone === "danger" && "border-danger-light")}
      data-testid={`tile-${id}`}
    >
      <b
        data-testid={`tile-${id}-value`}
        className={cn(
          "font-heading-style text-[30px] leading-tight",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </b>
      <span className="text-sm font-bold">{label}</span>
      <span className="text-[13px] text-muted-foreground">{sub}</span>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-heading-style text-lg">{title}</h2>
      {children}
    </section>
  );
}

// M12.03: tapping a name opens that salesperson's follow-ups.
async function PeopleTable({ people }: { people: PersonRow[] }) {
  const t = await getTranslations("overview.people");
  const head = "px-3 py-2.5 text-right text-[13px] font-bold text-muted-foreground";
  const cell = "px-3 py-2.5 text-right tabular-nums";
  return (
    <Card className="shrink-0 overflow-x-auto p-0">
      <table className="w-full min-w-[34rem] text-[15px]">
        <thead className="border-b border-border">
          <tr>
            <th className={cn(head, "text-left")}>{t("name")}</th>
            <th className={head}>{t("visits")}</th>
            <th className={head}>{t("due")}</th>
            <th className={head}>{t("done")}</th>
            <th className={head}>{t("overdue")}</th>
            <th className={head}>{t("sales")}</th>
            <th className={head}>{t("conversions")}</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr
              key={person.id}
              className="border-b border-border last:border-0"
              data-testid="person-row"
            >
              <td className="px-3 py-2.5">
                <Link
                  href={`/follow-ups?assignedTo=${person.id}`}
                  className="font-bold text-primary"
                >
                  {person.name}
                </Link>
                {!person.active && (
                  <span className="ml-1.5 text-[13px] text-muted-foreground">{t("inactive")}</span>
                )}
              </td>
              <td className={cell}>{person.visits}</td>
              <td className={cell}>{person.due}</td>
              <td className={cell}>{person.done}</td>
              <td
                className={cn(cell, person.overdue >= OVERDUE_WARN && "font-extrabold text-danger")}
              >
                {person.overdue}
              </td>
              <td className={cn(cell, "font-extrabold")}>{person.sales}</td>
              <td className={cell}>{person.conversions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function AlertCard({
  title,
  rows,
  more,
  moreHref,
  detail,
  "data-testid": testId,
}: {
  title: string;
  rows: AlertFollowUp[];
  more: number;
  moreHref?: string;
  detail: (row: AlertFollowUp) => string;
  "data-testid": string;
}) {
  const t = await getTranslations("overview.alerts");
  if (rows.length === 0) return null;
  return (
    <Card className="flex flex-col gap-2 border-danger-light p-4" data-testid={testId}>
      <p className="flex items-center gap-2 font-bold text-danger">
        <AlertTriangle aria-hidden className="size-5" />
        {title}
      </p>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/follow-ups/${row.id}`}
              className="flex items-center gap-3 border-t border-border py-2.5 text-[15px] first:border-0"
            >
              <span className="min-w-0 grow">
                <b className="block">{row.customer.name}</b>
                <span className="block text-sm text-muted-foreground">
                  {detail(row)} · {row.assignedTo.fullName}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 &&
        (moreHref ? (
          <Link href={moreHref} className="text-sm font-bold text-primary">
            {t("more", { count: more })}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{t("more", { count: more })}</p>
        ))}
    </Card>
  );
}
