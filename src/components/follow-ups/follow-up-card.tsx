import { MessageCircle, Phone } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import type { Locale } from "@/i18n/config";
import { telHref, whatsappHref } from "@/lib/contact-links";
import { followUpTiming, type FollowUpRow } from "@/lib/follow-up-list";
import { MISSED_CALLS_ALERT } from "@/lib/follow-ups";
import { formatDayDate } from "@/lib/format";

type FollowUpCardProps = {
  followUp: FollowUpRow;
  today: string; // IST calendar day, from the page's one clock reading
  showDate?: boolean; // the Follow-ups list spans many days; Today's cards do not
  showAssignee?: boolean; // a manager's list covers everyone
};

// One follow-up (M11.06): customer name (opens the profile), what they want, when, why,
// and Call / WhatsApp / Update. A finished one shows its status and result instead.
export async function FollowUpCard({ followUp, today, showDate, showAssignee }: FollowUpCardProps) {
  const t = await getTranslations("followUps");
  const tResult = await getTranslations("followUpResult");
  const tCustomers = await getTranslations("customers");
  const locale = (await getLocale()) as Locale;
  const { customer } = followUp;
  const pending = followUp.status === "PENDING";
  const timing = followUpTiming(followUp.dueDate, today);
  const slot = t(`slotWord.${followUp.timeSlot}`);
  const when = showDate
    ? tResult("dueOn", { date: formatDayDate(followUp.dueDate, locale), slot })
    : slot;

  return (
    <Card className="flex flex-col gap-3 p-3.5" data-testid="follow-up-card">
      <div className="flex items-center gap-3">
        <Avatar name={customer.name} />
        <div className="min-w-0 grow">
          <Link
            href={`/customers/${customer.id}`}
            className="font-extrabold text-foreground underline-offset-2 hover:underline"
          >
            {customer.name}
          </Link>
          <p className="text-sm text-muted-foreground">
            {followUp.enquiry.title} · {when}
          </p>
          {showAssignee && (
            <p className="text-sm text-muted-foreground">
              {tCustomers("handledBy", { name: followUp.assignedTo.fullName })}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {!pending ? (
            <Pill tone={followUp.status === "DONE" ? "green" : "grey"}>
              {t(`list.status.${followUp.status}`)}
            </Pill>
          ) : timing.kind === "late" ? (
            <Pill tone="red">{t("card.daysLate", { count: timing.days })}</Pill>
          ) : timing.kind === "today" ? (
            <Pill tone="blue">{t("card.today")}</Pill>
          ) : null}
          {pending && followUp.notReachableCount >= MISSED_CALLS_ALERT && (
            <Pill tone="red">{tResult("missedCalls", { count: followUp.notReachableCount })}</Pill>
          )}
        </div>
      </div>

      {followUp.reason && <p className="text-sm leading-relaxed text-ink-2">{followUp.reason}</p>}
      {!pending && followUp.result && (
        <p className="text-sm text-ink-2">{tResult(`option.${followUp.result}.label`)}</p>
      )}

      {pending && (
        <div className="flex gap-2">
          {customer.mobile && (
            <>
              <Button asChild variant="secondary" size="sm">
                <a href={telHref(customer.mobile)}>
                  <Phone aria-hidden className="size-4.5" />
                  {tResult("call")}
                </a>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <a href={whatsappHref(customer.mobile)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden className="size-4.5" />
                  {tResult("whatsapp")}
                </a>
              </Button>
            </>
          )}
          <Button asChild size="sm">
            <Link href={`/follow-ups/${followUp.id}`}>{t("card.update")}</Link>
          </Button>
        </div>
      )}
    </Card>
  );
}
