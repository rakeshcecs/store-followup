import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { FindCustomerButton } from "@/components/customers/find-customer-button";
import { FollowUpCard } from "@/components/follow-ups/follow-up-card";
import { AppShell } from "@/components/layout/app-shell";
import { AutoRefresh } from "@/components/refresh/auto-refresh";
import { PullToRefresh } from "@/components/refresh/pull-to-refresh";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { formatDayDate, istHour } from "@/lib/format";
import { staffName } from "@/lib/staff-name";
import { greetingKey, loadToday } from "@/lib/today";
import { cn } from "@/lib/utils";

// M11: the salesperson's home — "Who should I contact today?" Managers and admins land on
// Overview instead, and reach every follow-up from the Follow-ups tab.
export default async function TodayPage() {
  const user = await requireUser();
  if (user.role !== "SALESPERSON") notFound();
  const t = await getTranslations("today");
  const tFollowUps = await getTranslations("followUps");
  const locale = (await getLocale()) as Locale;

  // One clock reading for the whole screen, so a follow-up can't be "today" in the
  // counts and "overdue" in the list across midnight.
  const now = new Date();
  const [data, fullName] = await Promise.all([loadToday(user, now), staffName(user.id)]);
  const firstName = fullName.trim().split(/\s+/)[0] ?? "";
  const hiddenOverdue = data.counts.overdue - data.overdue.length;

  return (
    <AppShell
      role={user.role}
      title={t(`greeting.${greetingKey(istHour(now))}`, { name: firstName })}
      subtitle={formatDayDate(now, locale)}
    >
      <PullToRefresh />
      <AutoRefresh />
      <FindCustomerButton />

      <div className="grid grid-cols-3 gap-2.5">
        <Count value={data.counts.dueToday} label={t("counts.dueToday")} />
        <Count value={data.counts.overdue} label={t("counts.overdue")} tone="danger" />
        <Count value={data.counts.salesToday} label={t("counts.salesToday")} tone="success" />
      </div>

      {data.counts.overdue > 0 && (
        <Section title={t("overdue", { count: data.counts.overdue })} tone="danger">
          {data.overdue.map((followUp) => (
            <FollowUpCard key={followUp.id} followUp={followUp} today={data.today} />
          ))}
          {hiddenOverdue > 0 && (
            <Link
              href="/follow-ups?tab=overdue"
              className="text-center text-sm font-bold text-primary"
            >
              {t("overdueMore", { count: hiddenOverdue })}
            </Link>
          )}
        </Section>
      )}

      <Section title={t("dueToday", { count: data.counts.dueToday })}>
        {data.dueToday.length > 0 ? (
          data.dueToday.map((followUp) => (
            <FollowUpCard key={followUp.id} followUp={followUp} today={data.today} />
          ))
        ) : (
          <Card className="p-4.5 text-center text-[15px] text-muted-foreground">{t("empty")}</Card>
        )}
      </Section>

      {data.comingUp.length > 0 && (
        <Section title={t("comingUp")}>
          {data.comingUp.map((followUp) => (
            <Card key={followUp.id} className="flex items-center gap-3 px-3.5 py-3">
              <Avatar name={followUp.customer.name} />
              <div className="min-w-0 grow">
                <Link
                  href={`/customers/${followUp.customer.id}`}
                  className="font-extrabold text-foreground underline-offset-2 hover:underline"
                >
                  {followUp.customer.name}
                </Link>
                {/* "Sat, 26 Sep · evening · Phone call" */}
                <p className="text-sm text-muted-foreground">
                  {formatDayDate(followUp.dueDate, locale)} ·{" "}
                  {tFollowUps(`slotWord.${followUp.timeSlot}`)} ·{" "}
                  {tFollowUps(`method.${followUp.method}`)}
                </p>
              </div>
            </Card>
          ))}
        </Section>
      )}
    </AppShell>
  );
}

// Overdue in red, sales in green (prototype).
function Count({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "danger" | "success";
}) {
  return (
    <Card className={cn("flex flex-col gap-1 p-3", tone === "danger" && "border-danger-light")}>
      <b
        className={cn(
          "font-heading-style text-[26px] leading-none",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </b>
      <span className="text-[13px] leading-tight font-semibold text-ink-2">{label}</span>
    </Card>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={cn("font-heading-style text-lg", tone === "danger" && "text-danger")}>
        {title}
      </h2>
      {children}
    </section>
  );
}
