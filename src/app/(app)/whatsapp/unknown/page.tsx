import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HandledButton } from "@/app/(app)/whatsapp/unknown/handled-button";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime, formatMobile } from "@/lib/format";

const SHOWN = 100;

// M22 "Unknown contacts": WhatsApp messages from numbers that are no customer's. The store
// has one WhatsApp number for every branch, so a manager sees them all; the number can be
// added as a customer from here (it is then filled in on the new-customer form).
export default async function UnknownContactsPage() {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const t = await getTranslations("whatsapp.unknown");
  const tReports = await getTranslations("reports");
  const locale = (await getLocale()) as Locale;

  const rows = await db.whatsAppUnknownMessage.findMany({
    where: { handledAt: null },
    orderBy: { receivedAt: "desc" },
    take: SHOWN,
    select: { id: true, fromMobile: true, profileName: true, body: true, receivedAt: true },
  });

  return (
    <AppShell role={user.role} title={t("title")} backHref="/reports" backLabel={tReports("title")}>
      <p className="text-sm text-muted-foreground">{t("text")}</p>
      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t("empty")} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const mobile = /^[6-9]\d{9}$/.test(row.fromMobile) ? row.fromMobile : null;
            return (
              <li key={row.id}>
                <Card className="flex flex-col gap-2.5 p-3.5" data-testid="unknown-message">
                  <p className="font-bold">
                    {mobile ? formatMobile(mobile) : row.fromMobile}
                    {row.profileName ? ` · ${row.profileName}` : ""}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {formatDateTime(row.receivedAt, locale)}
                  </p>
                  <p className="text-[15px] leading-relaxed break-words whitespace-pre-line">
                    {row.body}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {mobile && (
                      <Button asChild size="sm">
                        <Link href={`/customers?mobile=${mobile}`}>{t("addCustomer")}</Link>
                      </Button>
                    )}
                    <HandledButton id={row.id} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
