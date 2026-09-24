import { CheckCircle2, MessageCircle, Phone } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ResultForm } from "@/app/(app)/follow-ups/[id]/result-form";
import { AppShell } from "@/components/layout/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { followUpAccessWhere, MISSED_CALLS_ALERT } from "@/lib/follow-ups";
import { formatDayDate, isoDate } from "@/lib/format";
import { activeLostReasons } from "@/lib/master-lists";
import { cn } from "@/lib/utils";

// Update follow-up (M09): what happened after the call. Opened from the profile's pending
// follow-up until the Today screen (M11) and notifications (M12) link here. A salesperson
// opens the ones assigned to them; a manager those of their branches; an admin all —
// anything else is simply not found (followUpAccessWhere, the action's own rule).
//
// branch-scope-exempt: followUpAccessWhere() is branchWhere(accessScope(user)) plus the
// salesperson's own-follow-ups rule (src/lib/follow-ups.ts).
export default async function UpdateFollowUpPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const t = await getTranslations("followUpResult");
  const tFollowUps = await getTranslations("followUps");
  const locale = (await getLocale()) as Locale;

  const followUp = await db.followUp.findFirst({
    where: { id, ...followUpAccessWhere(user) },
    select: {
      id: true,
      dueDate: true,
      timeSlot: true,
      reason: true,
      status: true,
      notReachableCount: true,
      customer: { select: { id: true, name: true, mobile: true } },
      enquiry: { select: { title: true } },
    },
  });
  if (!followUp) notFound();
  const { customer } = followUp;

  const shell = (children: ReactNode) => (
    <AppShell
      role={user.role}
      title={t("title")}
      backHref={`/customers/${customer.id}`}
      backLabel={t("back")}
    >
      {children}
    </AppShell>
  );

  if (followUp.status !== "PENDING") {
    return shell(
      <Card>
        <EmptyState
          icon={CheckCircle2}
          title={t("done")}
          text={t("doneText", { name: customer.name })}
          action={
            <Button asChild>
              <Link href={`/customers/${customer.id}`}>{t("openProfile")}</Link>
            </Button>
          }
        />
      </Card>,
    );
  }

  const now = new Date();
  const today = isoDate(now);
  const due = isoDate(followUp.dueDate);
  const slot = tFollowUps(`slotWord.${followUp.timeSlot}`);
  const dueLine =
    due < today
      ? t("wasDue", { date: formatDayDate(followUp.dueDate, locale) })
      : due === today
        ? t("dueToday", { slot })
        : t("dueOn", { date: formatDayDate(followUp.dueDate, locale), slot });

  return shell(
    <>
      {/* M09.02: who, what they want, when it was due, why, and a way to reach them. */}
      <Card className="flex flex-col gap-3 p-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={customer.name} />
          <div className="min-w-0 grow">
            <p className="font-extrabold">{customer.name}</p>
            <p className="text-sm text-muted-foreground">
              {followUp.enquiry.title} ·{" "}
              <span className={cn(due < today && "font-bold text-danger")}>{dueLine}</span>
            </p>
          </div>
          {followUp.notReachableCount >= MISSED_CALLS_ALERT && (
            <Pill tone="red">{t("missedCalls", { count: followUp.notReachableCount })}</Pill>
          )}
        </div>
        {followUp.reason && (
          <p className="rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed">
            {followUp.reason}
          </p>
        )}
        {customer.mobile && (
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <a href={`tel:+91${customer.mobile}`}>
                <Phone aria-hidden className="size-4.5" />
                {t("call")}
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a
                href={`https://wa.me/91${customer.mobile}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle aria-hidden className="size-4.5" />
                {t("whatsapp")}
              </a>
            </Button>
          </div>
        )}
      </Card>

      <ResultForm
        userId={user.id}
        followUp={{ id: followUp.id, customerId: customer.id }}
        reasons={(await activeLostReasons(locale)).map(({ id: value, name }) => ({
          id: value,
          name,
        }))}
        today={today}
      />
    </>,
  );
}
