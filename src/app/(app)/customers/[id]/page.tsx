import { MessageCircle, Phone } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerHeader } from "@/app/(app)/customers/[id]/customer-header";
import { EnquiryCard } from "@/app/(app)/customers/[id]/enquiry-card";
import { HistoryList } from "@/app/(app)/customers/[id]/history-list";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
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
  const tResult = await getTranslations("followUpResult");
  const tWhatsApp = await getTranslations("whatsapp");
  const locale = (await getLocale()) as Locale;

  const customer = await customerProfile(id);
  if (!customer) notFound();

  const take = eventCount(events);
  const timeline = await customerTimeline(customer.id, take);

  return (
    <AppShell
      role={user.role}
      title={t("profile.title")}
      backHref="/customers"
      backLabel={t("back")}
    >
      <CustomerHeader
        customer={customer}
        editHref={canEditCustomer(user, customer) ? `/customers/${customer.id}/edit` : undefined}
        reassignHref={
          user.role === "SALESPERSON"
            ? undefined
            : `/staff/reassign?from=${customer.assignedToId}&customer=${customer.id}`
        }
        deleteHref={user.role === "ADMIN" ? `/customers/${customer.id}/delete-data` : undefined}
      />
      {customer.mobile && (
        <div className="flex flex-col gap-2">
          {/* M06.02: the call and the chat open on the phone; nothing is ever sent by
              itself. In the page, not the top bar: with the language switcher, the bell
              and the avatar there as well, a phone had no room left for the title. */}
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="secondary">
              <a
                href={telHref(customer.mobile)}
                aria-label={t("profile.call", { name: customer.name })}
              >
                <Phone aria-hidden />
                {tResult("call")}
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a
                href={whatsappHref(customer.mobile)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("profile.whatsapp", { name: customer.name })}
              >
                <MessageCircle aria-hidden />
                {tResult("whatsapp")}
              </a>
            </Button>
          </div>
          {/* M22: the store's own WhatsApp (templates, consent, replies). */}
          <Button asChild variant="secondary">
            <Link href={`/customers/${customer.id}/whatsapp`}>
              <MessageCircle aria-hidden />
              {tWhatsApp("send")}
            </Link>
          </Button>
        </div>
      )}
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
