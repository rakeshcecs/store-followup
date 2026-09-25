import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { TIMELINE_MAX, TIMELINE_PAGE, type TimelineRow } from "@/lib/customers";
import { formatDate, formatDateTime, formatDayDate } from "@/lib/format";
import type { BranchScope } from "@/lib/permissions";
import { MessageStatusTicks } from "@/components/whatsapp/message-status";
import {
  readReassignDetail,
  systemByline,
  TIMELINE,
  timelineTone,
  type TimelineTone,
} from "@/lib/timeline";
import { cn } from "@/lib/utils";

const DOT: Record<TimelineTone, string> = {
  amber: "bg-warning",
  green: "bg-success",
  grey: "bg-dot",
  indigo: "bg-primary",
};

// The two names a reassignment row keeps in its detail (src/lib/reassign.ts).
function reassignNames(event: TimelineRow): { from: string; to: string } | null {
  return event.type === TIMELINE.reassigned.type ? readReassignDetail(event.detail) : null;
}

// M06.05: newest first — date, what happened, the remarks, and who did it.
export async function HistoryList({
  customerId,
  events,
  hasMore,
  take,
  locale,
  saleScope,
}: {
  customerId: string;
  events: TimelineRow[];
  hasMore: boolean;
  take: number;
  locale: Locale;
  // The branches whose sales the reader may open from their row to correct or cancel them
  // (M10.09): a manager's or an admin's. Null for a salesperson, who opens none.
  saleScope: BranchScope | null;
}) {
  const t = await getTranslations("customers.profile");
  // The title is a message key stored on the row (src/lib/timeline.ts), so it is only
  // known at run time and cannot be type-checked here.
  const tAll = await getTranslations();
  const title = (key: string) =>
    tAll.has(key as Parameters<typeof tAll>[0]) ? tAll(key as Parameters<typeof tAll>[0]) : key;
  // "Follow-up set for Sat, 26 Sep, evening" (M08) and "Follow-up call · Spoke, will visit
  // Sun, 27 Sep" (M09) take the day from the follow-up the row points at; rows written
  // before M08 point at none and keep the plain title.
  const tFollowUps = await getTranslations("followUps");
  const tWhatsApp = await getTranslations("whatsapp");
  const byline = (event: TimelineRow) => event.staffName ?? title(systemByline(event.type));
  const heading = (event: TimelineRow) => {
    // M15.03: "Reassigned from Amit to Priya"; the byline below names who did it.
    const names = reassignNames(event);
    if (names) return tAll("timeline.reassignedFromTo", names);
    // M24.04: "Imported on 24 Sep 2026 by Amit".
    if (event.type === TIMELINE.imported.type)
      return tAll("timeline.importedOnBy", {
        date: formatDate(event.createdAt, locale),
        name: event.staffName ?? "",
      });
    const key = event.type === TIMELINE.followUpSet.type ? "timeline.followUpSetFor" : event.title;
    if (!event.followUp || !tAll.has(key as Parameters<typeof tAll>[0])) return title(event.title);
    return tAll(key as Parameters<typeof tAll>[0], {
      date: formatDayDate(event.followUp.dueDate, locale),
      slot: tFollowUps(`slotWord.${event.followUp.timeSlot}`),
    });
  };
  const canOpen = (event: TimelineRow) =>
    saleScope !== null &&
    event.entityId !== null &&
    event.type.startsWith("sale.") &&
    event.branchId !== null &&
    (saleScope.all || saleScope.branchIds.includes(event.branchId));

  return (
    <section className="flex flex-col gap-3.5">
      <h3 className="font-heading-style text-lg">{t("history")}</h3>

      {events.length === 0 ? (
        <p className="text-muted-foreground">{t("noHistory")}</p>
      ) : (
        <ol>
          {events.map((event, index) => (
            <li key={event.id} className="flex gap-3.5">
              <div aria-hidden className="flex w-3.5 shrink-0 flex-col items-center">
                <span
                  data-tone={timelineTone(event.type)}
                  className={cn("mt-1.5 size-3 rounded-full", DOT[timelineTone(event.type)])}
                />
                {index < events.length - 1 && <span className="mt-1 w-0.5 grow bg-rail" />}
              </div>
              <div className="grow pb-4.5">
                <p className="text-[13px] font-bold text-muted-foreground">
                  {formatDateTime(event.createdAt, locale)}
                </p>
                <p className="text-[15px] font-extrabold">
                  {canOpen(event) ? (
                    <Link href={`/sales/${event.entityId}`} className="text-primary">
                      {title(event.title)}
                    </Link>
                  ) : (
                    heading(event)
                  )}
                </p>
                {event.detail && !reassignNames(event) && (
                  <p className="text-sm leading-relaxed whitespace-pre-line text-ink-2">
                    {event.detail}
                  </p>
                )}
                {event.whatsappStatus && (
                  <MessageStatusTicks
                    status={event.whatsappStatus}
                    label={tWhatsApp(`status.${event.whatsappStatus}`)}
                  />
                )}
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {event.branchName
                    ? t("byAt", { name: byline(event), branch: event.branchName })
                    : byline(event)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {hasMore &&
        (take < TIMELINE_MAX ? (
          <Link
            href={`/customers/${customerId}?events=${take + TIMELINE_PAGE}`}
            scroll={false}
            className="self-start font-bold text-primary"
          >
            {t("showMore")}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">{t("olderInAudit")}</p>
        ))}
    </section>
  );
}
