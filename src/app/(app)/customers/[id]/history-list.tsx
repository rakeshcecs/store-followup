import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { TIMELINE_MAX, TIMELINE_PAGE, type TimelineRow } from "@/lib/customers";
import { formatDateTime } from "@/lib/format";
import { timelineTone, type TimelineTone } from "@/lib/timeline";
import { cn } from "@/lib/utils";

const DOT: Record<TimelineTone, string> = {
  amber: "bg-warning",
  green: "bg-success",
  grey: "bg-dot",
  indigo: "bg-primary",
};

// M06.05: newest first — date, what happened, the remarks, and who did it.
export async function HistoryList({
  customerId,
  events,
  hasMore,
  take,
  locale,
}: {
  customerId: string;
  events: TimelineRow[];
  hasMore: boolean;
  take: number;
  locale: Locale;
}) {
  const t = await getTranslations("customers.profile");
  // The title is a message key stored on the row (src/lib/timeline.ts), so it is only
  // known at run time and cannot be type-checked here.
  const tAll = await getTranslations();
  const title = (key: string) =>
    tAll.has(key as Parameters<typeof tAll>[0]) ? tAll(key as Parameters<typeof tAll>[0]) : key;

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
                <p className="text-[15px] font-extrabold">{title(event.title)}</p>
                {event.detail && (
                  <p className="text-sm leading-relaxed whitespace-pre-line text-ink-2">
                    {event.detail}
                  </p>
                )}
                <p className="mt-0.5 text-[13px] text-muted-foreground">{event.staffName}</p>
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
