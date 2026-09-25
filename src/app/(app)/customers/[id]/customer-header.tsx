import { Pencil } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Pill } from "@/components/ui/pill";
import { CUSTOMER_STATUS_TONE } from "@/lib/customer-status";
import type { CustomerProfile } from "@/lib/customers";
import type { Locale } from "@/i18n/config";
import { formatDate, formatMobile } from "@/lib/format";

const SEPARATOR = " · ";

// M06.01: who this is, how to reach them, where they stand and who looks after them.
// `editHref`: for whoever may change the details (M06.05).
// `reassignHref`: a manager's or an admin's way to hand the customer to someone else (M15).
// `deleteHref`: the admin's privacy delete (M16.03).
export async function CustomerHeader({
  customer,
  editHref,
  reassignHref,
  deleteHref,
}: {
  customer: CustomerProfile;
  editHref?: string;
  reassignHref?: string;
  deleteHref?: string;
}) {
  const t = await getTranslations("customers.profile");
  const locale = (await getLocale()) as Locale;
  // M16.02: consent is saved with the date and the staff member who recorded it.
  const consent =
    customer.consent.given && customer.consent.at
      ? t("consentGiven", {
          date: formatDate(customer.consent.at, locale),
          name: customer.consent.byName ?? t("someone"),
        })
      : t("consentNone");

  const contact = [customer.mobile && formatMobile(customer.mobile), customer.area]
    .filter(Boolean)
    .join(" · ");
  const owner = [customer.departmentName, customer.assignedToName].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <Avatar name={customer.name} size="lg" />
        <div className="min-w-0">
          <h2 className="font-heading-style text-[26px] leading-tight">{customer.name}</h2>
          {contact && <p className="text-[15px] text-muted-foreground">{contact}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone={CUSTOMER_STATUS_TONE[customer.status]}>{t(`status.${customer.status}`)}</Pill>
        <Pill tone="grey">{owner}</Pill>
        {editHref && (
          <Link
            href={editHref}
            className="inline-flex items-center gap-1 self-center text-sm font-bold text-primary"
          >
            <Pencil aria-hidden className="size-3.5" />
            {t("edit")}
          </Link>
        )}
        {reassignHref && (
          <Link href={reassignHref} className="self-center text-sm font-bold text-primary">
            {t("changeSalesperson")}
          </Link>
        )}
      </div>
      <p className="text-sm text-muted-foreground" data-testid="consent">
        {consent}
        {deleteHref && (
          <>
            {SEPARATOR}
            <Link href={deleteHref} className="font-bold text-danger">
              {t("deleteData")}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
