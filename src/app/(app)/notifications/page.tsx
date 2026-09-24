import { Bell, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { MarkAllRead } from "@/app/(app)/notifications/mark-read";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { renderNotifications } from "@/lib/notification-text";
import { bellSince } from "@/lib/notifications";
import { cn } from "@/lib/utils";

// M14.06: the bell list — the last 30 days, newest first, each opening its screen.
// Everyone's own rows only.
export default async function NotificationsPage() {
  const user = await requireUser();
  const t = await getTranslations("notifications");
  const locale = (await getLocale()) as Locale;

  const rows = await db.notification.findMany({
    where: { userId: user.id, sentAt: { gte: bellSince(new Date()) } },
    orderBy: { sentAt: "desc" },
    select: { id: true, type: true, message: true, link: true, sentAt: true, readAt: true },
  });
  const texts = await renderNotifications(rows, locale);
  const unread = rows.filter((row) => !row.readAt).length;

  return (
    <AppShell role={user.role} title={t("title")}>
      <MarkAllRead unread={unread} />
      {rows.length === 0 ? (
        <Card className="p-2">
          <EmptyState icon={Bell} title={t("empty")} text={t("emptyText")} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const text = texts.get(row.id);
            if (!text) return null;
            return (
              <li key={row.id}>
                <Card className={cn(!row.readAt && "border-primary-light bg-primary-light/40")}>
                  <Link
                    href={text.link}
                    className="flex items-center gap-3 p-3.5"
                    data-testid="notification-row"
                  >
                    <span className="min-w-0 grow">
                      <span className="block font-extrabold">{text.title}</span>
                      {text.body && (
                        <span className="block text-[15px] text-ink-2">{text.body}</span>
                      )}
                      <span className="block text-sm text-muted-foreground">
                        {formatDateTime(row.sentAt, locale)}
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
