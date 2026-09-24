import { MessageCircle, Pencil, Phone } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerHeader } from "@/app/(app)/customers/[id]/customer-header";
import { EnquiryCard } from "@/app/(app)/customers/[id]/enquiry-card";
import { HistoryList } from "@/app/(app)/customers/[id]/history-list";
import { AppShell } from "@/components/layout/app-shell";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { telHref, whatsappHref } from "@/lib/contact-links";
import {
  canEditCustomer,
  customerProfile,
  customerTimeline,
  TIMELINE_MAX,
  TIMELINE_PAGE,
} from "@/lib/customers";
import { canUpdateFollowUp } from "@/lib/follow-ups";
import { accessScope } from "@/lib/permissions";

// Customer profile and history (M06). Every role uses it — the SOW's screen list says
// "Used by: All" — and there is no branch filter: customers are shared across branches
// (BR-16), so anyone who found the number may see the whole history (SOW Q&A #3).

// Same shape as TopBar's own buttons; that file is a client module, so its class string
// cannot be imported into a server component.
const topBarButton =
  "flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-black/5";

// "Show older entries" is a link that asks for 20 more, not a cursor: the list is always
// "the newest N", so no row can ever appear twice, and it works with JavaScript off.
function eventCount(value: string | undefined): number {
  const asked = Number(value);
  if (!Number.isInteger(asked) || asked < TIMELINE_PAGE) return TIMELINE_PAGE;
  return Math.min(asked, TIMELINE_MAX);
}

export default async function CustomerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ events?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { events } = await searchParams;
  const t = await getTranslations("customers");
  const locale = (await getLocale()) as Locale;

  const customer = await customerProfile(id);
  if (!customer) notFound();

  const take = eventCount(events);
  const timeline = await customerTimeline(customer.id, take);

  // M06.02: the call and the chat open on the phone; nothing is ever sent by itself.
  // The store's WhatsApp template (the SOW's second choice) belongs to M22.
  const actions = (
    <>
      {customer.mobile && (
        <>
          <a
            href={telHref(customer.mobile)}
            aria-label={t("profile.call", { name: customer.name })}
            className={topBarButton}
          >
            <Phone aria-hidden className="size-6" />
          </a>
          <a
            href={whatsappHref(customer.mobile)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("profile.whatsapp", { name: customer.name })}
            className={topBarButton}
          >
            <MessageCircle aria-hidden className="size-6" />
          </a>
        </>
      )}
      {canEditCustomer(user, customer) && (
        <Link
          href={`/customers/${customer.id}/edit`}
          aria-label={t("profile.edit")}
          className={topBarButton}
        >
          <Pencil aria-hidden className="size-5" />
        </Link>
      )}
    </>
  );

  return (
    <AppShell
      role={user.role}
      title={t("profile.title")}
      backHref="/customers"
      backLabel={t("back")}
      actions={actions}
    >
      <CustomerHeader customer={customer} />
      <EnquiryCard
        customer={customer}
        locale={locale}
        canUpdateFollowUp={
          customer.pendingFollowUp !== null && canUpdateFollowUp(user, customer.pendingFollowUp)
        }
      />
      <HistoryList
        customerId={customer.id}
        events={timeline.events}
        hasMore={timeline.hasMore}
        take={take}
        locale={locale}
        saleScope={user.role === "SALESPERSON" ? null : accessScope(user)}
      />
    </AppShell>
  );
}
