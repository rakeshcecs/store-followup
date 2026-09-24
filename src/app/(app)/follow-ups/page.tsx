import { BellRing } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { FollowUpFilters } from "@/app/(app)/follow-ups/follow-up-filters";
import { FollowUpCard } from "@/components/follow-ups/follow-up-card";
import { AppShell } from "@/components/layout/app-shell";
import { AutoRefresh } from "@/components/refresh/auto-refresh";
import { PullToRefresh } from "@/components/refresh/pull-to-refresh";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import {
  LIST_MAX,
  LIST_PAGE,
  LIST_TABS,
  countFollowUps,
  listFollowUps,
  parseListFilters,
} from "@/lib/follow-up-list";
import { isoDate } from "@/lib/format";
import { staffBranchWhere } from "@/lib/staff-scope";
import { cn } from "@/lib/utils";

type Search = Record<string, string | string[] | undefined>;

// All follow-ups (M11, SOW screen 10 "Used by: All"): tabs Pending / Overdue / Done / All,
// a date range, name-or-mobile search, and for a manager or admin a salesperson filter.
// A salesperson sees only the follow-ups assigned to them.
export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = parseListFilters(params);
  const t = await getTranslations("followUps.list");
  const salesperson = user.role === "SALESPERSON";
  const scope = await getBranchScope(user);

  const now = new Date();
  const [{ rows, hasMore }, counts, staff] = await Promise.all([
    listFollowUps(user, scope, filters, now),
    countFollowUps(user, scope, filters, now),
    salesperson
      ? null
      : db.user.findMany({
          where: {
            ...staffBranchWhere(scope),
            status: "ACTIVE",
            role: { in: ["SALESPERSON", "MANAGER"] },
          },
          orderBy: { fullName: "asc" },
          select: { id: true, fullName: true },
        }),
  ]);

  // Tab and "Show more" links keep every other filter as it is.
  const href = (change: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first) next.set(key, first);
    }
    for (const [key, value] of Object.entries(change)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    return query ? `/follow-ups?${query}` : "/follow-ups";
  };

  return (
    <AppShell role={user.role} title={t("title")}>
      <PullToRefresh />
      <AutoRefresh />

      <nav aria-label={t("title")} className="flex gap-1 rounded-lg bg-muted p-1">
        {LIST_TABS.map((tab) => {
          const active = tab === filters.tab;
          return (
            <Link
              key={tab}
              href={href({ tab: tab === "pending" ? undefined : tab, limit: undefined })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md text-sm font-bold text-muted-foreground",
                active && "bg-card text-foreground shadow-sm",
              )}
            >
              {t(`tabs.${tab}`)}
              {/* Under the same filters, so a search shows which tab holds the match. */}
              <span
                data-testid={`tab-count-${tab}`}
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-xs tabular-nums",
                  active ? "bg-primary-light text-primary" : "bg-card/60",
                )}
              >
                {counts[tab]}
              </span>
            </Link>
          );
        })}
      </nav>

      <FollowUpFilters
        staff={staff ? staff.map((person) => ({ id: person.id, name: person.fullName })) : null}
      />

      {rows.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon={BellRing}
            title={t(`empty.${filters.tab}`)}
            text={t("emptyText")}
            action={
              filters.q && filters.tab !== "all" && counts.all > 0 ? (
                <Button asChild variant="secondary">
                  <Link href={href({ tab: "all", limit: undefined })}>{t("searchAll")}</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((followUp) => (
            <li key={followUp.id}>
              <FollowUpCard
                followUp={followUp}
                today={isoDate(now)}
                showDate
                showAssignee={!salesperson}
              />
            </li>
          ))}
        </ul>
      )}

      {hasMore && filters.limit < LIST_MAX && (
        <Button asChild variant="secondary">
          <Link href={href({ limit: String(filters.limit + LIST_PAGE) })} scroll={false}>
            {t("showMore")}
          </Link>
        </Button>
      )}
    </AppShell>
  );
}
