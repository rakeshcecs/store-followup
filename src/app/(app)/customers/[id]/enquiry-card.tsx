import { CalendarClock, CalendarPlus, Check, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Locale } from "@/i18n/config";
import type { CustomerProfile } from "@/lib/customers";
import { formatDate, formatDayDate, isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// M06.03 / M06.04: the open enquiry, or the note that there is none, and the three ways
// on — Record visit (M07), Follow-up (M08), Sale done (M10). The three buttons stay
// either way, as in the prototype: M08 and M10 decide what to do without an enquiry.
export async function EnquiryCard({
  customer,
  locale,
  canUpdateFollowUp,
}: {
  customer: CustomerProfile;
  locale: Locale;
  canUpdateFollowUp: boolean; // M09: the reader may record what happened on it
}) {
  const t = await getTranslations("customers.profile");
  const tFollowUps = await getTranslations("followUps");
  const pending = customer.pendingFollowUp;
  const overdue = pending !== null && isoDate(pending.dueDate) < isoDate(new Date());
  const enquiry = customer.openEnquiry;
  const query = `customerId=${customer.id}`;

  const occasion = [
    customer.occasion,
    customer.occasionDate && formatDate(customer.occasionDate, locale),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="flex flex-col gap-2.5 p-4">
      {enquiry ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-extrabold tracking-wide text-ink-2 uppercase">
              {t("openEnquiry")}
            </h3>
            <span className="text-[13px] font-bold text-muted-foreground">
              {t("since", { date: formatDate(enquiry.openedAt, locale) })}
            </span>
          </div>
          <p className="text-lg font-extrabold">{enquiry.title}</p>
          {enquiry.latestRemarks && (
            <p className="text-sm leading-relaxed text-ink-2">{enquiry.latestRemarks}</p>
          )}
          {occasion && (
            <p className="text-sm text-muted-foreground">{t("occasion", { value: occasion })}</p>
          )}
          {pending && (
            <div className="flex items-center gap-2.5 rounded-md bg-muted px-3 py-2">
              <CalendarClock
                aria-hidden
                className={cn("size-5 shrink-0", overdue ? "text-danger" : "text-primary")}
              />
              <p className={cn("grow text-sm font-bold", overdue && "text-danger")}>
                {overdue
                  ? t("followUpWasDue", { date: formatDayDate(pending.dueDate, locale) })
                  : t("followUpDue", {
                      date: formatDayDate(pending.dueDate, locale),
                      slot: tFollowUps(`slotWord.${pending.timeSlot}`),
                    })}
              </p>
              {canUpdateFollowUp && (
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/follow-ups/${pending.id}`}>{t("updateFollowUp")}</Link>
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-base font-extrabold">{t("noEnquiry")}</p>
          <p className="text-sm text-muted-foreground">{t("noEnquiryText")}</p>
        </>
      )}

      <div className="mt-1 grid grid-cols-3 gap-2">
        <Button asChild variant="secondary" size="sm" className="min-h-16 flex-col gap-0.5">
          <Link href={`/visits/new?${query}`}>
            <Plus aria-hidden />
            {t("addVisit")}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="min-h-16 flex-col gap-0.5">
          <Link href={`/follow-ups/new?${query}`}>
            <CalendarPlus aria-hidden />
            {t("followUp")}
          </Link>
        </Button>
        <Button asChild size="sm" className="min-h-16 flex-col gap-0.5">
          <Link href={`/sales/new?${query}`}>
            <Check aria-hidden />
            {t("saleDone")}
          </Link>
        </Button>
      </div>
    </Card>
  );
}
