"use client";

import { MessageCircle, Phone, Search, UserPlus, WifiOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { MobileInput } from "@/app/(app)/customers/mobile-input";
import { CustomerForm } from "@/app/(app)/customers/new/customer-form";
import { ResultForm } from "@/app/(app)/follow-ups/[id]/result-form";
import { FollowUpForm } from "@/app/(app)/follow-ups/new/follow-up-form";
import { SaleForm } from "@/app/(app)/sales/new/sale-form";
import { VisitForm } from "@/app/(app)/visits/new/visit-form";
import type { OfflineData } from "@/components/offline/hooks";
import { CustomerStrip } from "@/components/customers/customer-strip";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import type { Locale } from "@/i18n/config";
import { telHref, whatsappHref } from "@/lib/contact-links";
import { dayForDisplay, daysBetween } from "@/lib/follow-up-dates";
import { formatDayDate, formatMobile } from "@/lib/format";
import { normalizeMobile } from "@/lib/mobile";
import type { CachedCustomer, CachedFollowUp } from "@/lib/offline/types";
import { findByMobile, todayBuckets } from "@/lib/offline/view";
import { isLocalId } from "@/lib/sync/entries";

type Ready = Extract<OfflineData, { state: "ready" }>;
type ScreenProps = { data: Ready };

// Missed-call pill from 3 in a row (M09.06), as online.
const MISSED_CALLS_ALERT = 3;

// ---- pieces ----

function NotHere({ kind }: { kind: "customerNotHere" | "followUpNotHere" }) {
  const t = useTranslations(`offlineApp.${kind}`);
  const tNav = useTranslations("nav");
  return (
    <Card>
      <EmptyState
        icon={WifiOff}
        title={t("title")}
        text={t("text")}
        action={
          <Button asChild>
            <a href={kind === "customerNotHere" ? "/customers" : "/today"}>
              {kind === "customerNotHere" ? tNav("customers") : tNav("today")}
            </a>
          </Button>
        }
      />
    </Card>
  );
}

function PickBranch() {
  const t = useTranslations("offlineApp.pickBranch");
  return (
    <Card>
      <EmptyState title={t("title")} text={t("text")} />
    </Card>
  );
}

// "Sat, 26 Sep" of a "2026-09-26".
function useDay(): (day: string) => string {
  const locale = useLocale() as Locale;
  return (day) => formatDayDate(dayForDisplay(day), locale);
}

function Strip({ data, customer }: { data: Ready; customer: CachedCustomer }) {
  const t = useTranslations("visits");
  const day = useDay();
  return (
    <CustomerStrip
      name={customer.name}
      line={t("strip", { date: day(data.today), name: customer.assignedToName })}
    />
  );
}

function ContactButtons({ mobile }: { mobile: string | null }) {
  const t = useTranslations("followUpResult");
  if (!mobile) return null;
  return (
    <>
      <Button asChild variant="secondary" size="sm">
        <a href={telHref(mobile)}>
          <Phone aria-hidden className="size-4.5" />
          {t("call")}
        </a>
      </Button>
      <Button asChild variant="secondary" size="sm">
        <a href={whatsappHref(mobile)} target="_blank" rel="noopener noreferrer">
          <MessageCircle aria-hidden className="size-4.5" />
          {t("whatsapp")}
        </a>
      </Button>
    </>
  );
}

function FollowUpCard({ followUp, today }: { followUp: CachedFollowUp; today: string }) {
  const t = useTranslations("followUps");
  const tResult = useTranslations("followUpResult");
  const day = useDay();
  const late = followUp.dueDate < today;
  const when =
    followUp.dueDate === today
      ? t(`slotWord.${followUp.timeSlot}`)
      : tResult("dueOn", { date: day(followUp.dueDate), slot: t(`slotWord.${followUp.timeSlot}`) });
  return (
    <Card className="flex flex-col gap-3 p-3.5" data-testid="follow-up-card">
      <div className="flex items-center gap-3">
        <Avatar name={followUp.customerName} />
        <div className="min-w-0 grow">
          <a
            href={`/customers/${followUp.customerId}`}
            className="font-extrabold text-foreground underline-offset-2 hover:underline"
          >
            {followUp.customerName}
          </a>
          <p className="text-sm text-muted-foreground">
            {[followUp.enquiryTitle, when].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {late ? (
            <Pill tone="red">
              {t("card.daysLate", { count: daysBetween(followUp.dueDate, today) })}
            </Pill>
          ) : followUp.dueDate === today ? (
            <Pill tone="blue">{t("card.today")}</Pill>
          ) : null}
          {followUp.notReachableCount >= MISSED_CALLS_ALERT && (
            <Pill tone="red">{tResult("missedCalls", { count: followUp.notReachableCount })}</Pill>
          )}
        </div>
      </div>
      {followUp.reason && <p className="text-sm leading-relaxed text-ink-2">{followUp.reason}</p>}
      <div className="flex flex-wrap gap-2">
        <ContactButtons mobile={followUp.mobile} />
        <Button asChild size="sm">
          <a href={`/follow-ups/${followUp.id}`}>{t("card.update")}</a>
        </Button>
      </div>
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
      <h2
        className={
          tone === "danger"
            ? "font-heading-style text-lg text-danger"
            : "font-heading-style text-lg"
        }
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---- screens ----

// Today from the cached list, with what was saved offline laid over it (M19).
export function TodayScreen({ data }: ScreenProps) {
  const t = useTranslations("today");
  const tCustomers = useTranslations("customers");
  const { overdue, dueToday, comingUp } = todayBuckets(data.view.followUps, data.today);
  return (
    <>
      <Button asChild>
        <Link href="/customers">
          <UserPlus aria-hidden />
          {tCustomers("findCta")}
        </Link>
      </Button>
      {overdue.length > 0 && (
        <Section title={t("overdue", { count: overdue.length })} tone="danger">
          {overdue.map((row) => (
            <FollowUpCard key={row.id} followUp={row} today={data.today} />
          ))}
        </Section>
      )}
      <Section title={t("dueToday", { count: dueToday.length })}>
        {dueToday.length > 0 ? (
          dueToday.map((row) => <FollowUpCard key={row.id} followUp={row} today={data.today} />)
        ) : (
          <Card className="p-4.5 text-center text-[15px] text-muted-foreground">{t("empty")}</Card>
        )}
      </Section>
      {comingUp.length > 0 && (
        <Section title={t("comingUp")}>
          {comingUp.map((row) => (
            <FollowUpCard key={row.id} followUp={row} today={data.today} />
          ))}
        </Section>
      )}
    </>
  );
}

function CustomerCard({ customer }: { customer: CachedCustomer }) {
  const t = useTranslations("customers");
  const tOffline = useTranslations("offlineApp");
  return (
    <Card className="flex flex-col gap-3 p-3.5" data-testid="offline-customer-card">
      <div className="flex items-center gap-3">
        <Avatar name={customer.name} />
        <div className="min-w-0 grow">
          <a
            href={`/customers/${customer.id}`}
            className="font-extrabold text-foreground underline-offset-2 hover:underline"
          >
            {customer.name}
          </a>
          <p className="text-sm text-muted-foreground">{formatMobile(customer.mobile)}</p>
          {customer.assignedToName && (
            <p className="text-sm text-muted-foreground">
              {t("handledBy", { name: customer.assignedToName })}
            </p>
          )}
        </div>
        {isLocalId(customer.id) && <Pill tone="amber">{tOffline("addedOffline")}</Pill>}
      </div>
      {customer.openEnquiryTitle && (
        <p className="text-sm">{t("openEnquiry", { title: customer.openEnquiryTitle })}</p>
      )}
      <Button asChild>
        <a href={`/visits/new?customerId=${customer.id}`}>{t("addVisit")}</a>
      </Button>
    </Card>
  );
}

// Find customer by mobile, in the phone's copy (M19: last 90 days + today's follow-ups).
export function SearchScreen({ data, mobile }: ScreenProps & { mobile: string | null }) {
  const t = useTranslations("customers");
  const tOffline = useTranslations("offlineApp");
  const typed = mobile?.trim() ?? "";
  const number = typed ? normalizeMobile(typed) : null;
  const found = number ? findByMobile(data.view, number) : null;

  return (
    <>
      <form method="get" action="/customers" className="flex flex-col gap-4">
        <MobileInput
          label={t("fields.mobile")}
          hint={t("hints.mobile")}
          defaultValue={typed}
          error={typed && !number ? t("errors.mobileInvalid") : undefined}
          autoFocus
        />
        <Button type="submit">
          <Search aria-hidden />
          {t("search")}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">{tOffline("searchHint")}</p>
      {found && <CustomerCard customer={found} />}
      {number && !found && (
        <Card>
          <EmptyState
            icon={UserPlus}
            title={tOffline("notOnPhone.title", { mobile: formatMobile(number) })}
            text={tOffline("notOnPhone.text")}
            action={
              <Button asChild>
                <a href={`/customers/new?mobile=${number}`}>{t("create")}</a>
              </Button>
            }
          />
        </Card>
      )}
    </>
  );
}

export function NewCustomerScreen({ data, mobile }: ScreenProps & { mobile: string | null }) {
  const { cache } = data;
  if (!cache.branch) return <PickBranch />;
  return (
    <CustomerForm
      mobile={normalizeMobile(mobile) ?? ""}
      departments={cache.lists.departments}
      staff={cache.lists.staff}
      currentUserId={cache.user.id}
      defaultCity={cache.branch.city}
    />
  );
}

// The customer, as far as the phone knows them, and what can be done offline.
export function CustomerScreen({ data, id }: ScreenProps & { id: string }) {
  const t = useTranslations("customers.profile");
  const tFollowUps = useTranslations("followUps");
  const day = useDay();
  const customer = data.view.customers.get(id);
  if (!customer) return <NotHere kind="customerNotHere" />;
  const pending = customer.pending;
  const mine = pending && data.view.followUps.some((row) => row.id === pending.id);

  return (
    <>
      <CustomerCard customer={customer} />
      <Card className="flex flex-col gap-2 p-3.5">
        {customer.openEnquiryTitle ? (
          <p className="font-bold">
            {t("openEnquiry")}: {customer.openEnquiryTitle}
          </p>
        ) : (
          <p className="text-muted-foreground">{t("noEnquiry")}</p>
        )}
        {pending && (
          <p className="text-sm">
            {t("followUpDue", {
              date: day(pending.dueDate),
              slot: tFollowUps(`slotWord.${pending.timeSlot}`),
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <ContactButtons mobile={customer.mobile} />
          {mine && pending && (
            <Button asChild size="sm">
              <a href={`/follow-ups/${pending.id}`}>{t("updateFollowUp")}</a>
            </Button>
          )}
        </div>
      </Card>
      {customer.openEnquiryTitle && (
        <div className="grid grid-cols-2 gap-2.5">
          <Button asChild variant="secondary">
            <a href={`/follow-ups/new?customerId=${customer.id}`}>{t("followUp")}</a>
          </Button>
          <Button asChild variant="secondary">
            <a href={`/sales/new?customerId=${customer.id}`}>{t("saleDone")}</a>
          </Button>
        </div>
      )}
    </>
  );
}

export function VisitScreen({ data, customerId }: ScreenProps & { customerId: string }) {
  const customer = data.view.customers.get(customerId);
  if (!customer) return <NotHere kind="customerNotHere" />;
  if (!data.cache.branch) return <PickBranch />;
  return (
    <>
      <Strip data={data} customer={customer} />
      <VisitForm
        userId={data.cache.user.id}
        customerId={customer.id}
        categories={data.cache.lists.categories}
        reasons={data.cache.lists.reasons}
      />
    </>
  );
}

export function FollowUpScreen({
  data,
  customerId,
  draft,
}: ScreenProps & { customerId: string; draft: string | null }) {
  const day = useDay();
  const customer = data.view.customers.get(customerId);
  if (!customer) return <NotHere kind="customerNotHere" />;
  if (!data.cache.branch) return <PickBranch />;
  return (
    <>
      <Strip data={data} customer={customer} />
      <FollowUpForm
        userId={data.cache.user.id}
        customer={{ id: customer.id, name: customer.name }}
        draftId={draft}
        hasOpenEnquiry={customer.openEnquiryTitle !== null}
        replaces={customer.pending ? day(customer.pending.dueDate) : null}
        today={data.today}
      />
    </>
  );
}

export function SaleScreen({
  data,
  customerId,
  draft,
  followUpId,
}: ScreenProps & { customerId: string; draft: string | null; followUpId: string | null }) {
  const customer = data.view.customers.get(customerId);
  if (!customer) return <NotHere kind="customerNotHere" />;
  if (!data.cache.branch) return <PickBranch />;
  return (
    <>
      <Strip data={data} customer={customer} />
      <SaleForm
        userId={data.cache.user.id}
        customer={{ id: customer.id, name: customer.name }}
        draftId={draft}
        followUpId={followUpId}
        openEnquiryTitle={customer.openEnquiryTitle}
        amountRequired={data.cache.lists.billAmountRequired}
        today={data.today}
      />
    </>
  );
}

// Update follow-up (M09) for one on this person's list.
export function ResultScreen({ data, id }: ScreenProps & { id: string }) {
  const t = useTranslations("followUpResult");
  const tFollowUps = useTranslations("followUps");
  const day = useDay();
  const followUp = data.view.followUps.find((row) => row.id === id);
  if (!followUp) return <NotHere kind="followUpNotHere" />;
  const slot = tFollowUps(`slotWord.${followUp.timeSlot}`);
  const dueLine =
    followUp.dueDate < data.today
      ? t("wasDue", { date: day(followUp.dueDate) })
      : followUp.dueDate === data.today
        ? t("dueToday", { slot })
        : t("dueOn", { date: day(followUp.dueDate), slot });

  return (
    <>
      <Card className="flex flex-col gap-3 p-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={followUp.customerName} />
          <div className="min-w-0 grow">
            <p className="font-extrabold">{followUp.customerName}</p>
            <p className="text-sm text-muted-foreground">
              {[followUp.enquiryTitle, dueLine].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        {followUp.reason && (
          <p className="rounded-md bg-muted px-3 py-2.5 text-sm leading-relaxed">
            {followUp.reason}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <ContactButtons mobile={followUp.mobile} />
        </div>
      </Card>
      <ResultForm
        userId={data.cache.user.id}
        followUp={{ id: followUp.id, customerId: followUp.customerId }}
        reasons={data.cache.lists.reasons}
        today={data.today}
      />
    </>
  );
}

export function NeedsInternet() {
  const t = useTranslations("offlineApp.needsInternet");
  const tNav = useTranslations("nav");
  return (
    <Card>
      <EmptyState
        icon={WifiOff}
        title={t("title")}
        text={t("text")}
        action={
          <Button asChild>
            <a href="/today">{tNav("today")}</a>
          </Button>
        }
      />
    </Card>
  );
}
