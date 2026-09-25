import { ChevronRight, Search, UserPlus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { MobileInput } from "@/app/(app)/customers/mobile-input";
import { AppShell } from "@/components/layout/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Pill } from "@/components/ui/pill";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { findByMobile, recentlyHandledBy, type CustomerCard } from "@/lib/customers";
import { formatDate, formatMobile } from "@/lib/format";
import { normalizeMobile } from "@/lib/mobile";
import { firstParam, type SearchValue } from "@/lib/search-params";

// Find customer (M05). Everyone uses this screen — the SOW's screen list says
// "Used by: All" — so there is no role check beyond being signed in.
//
// The search is a GET form, not a client action: it works with JavaScript off, Enter
// submits without any key handling of our own, and the result has a URL that can be
// shared, reloaded and gone back to. The one client piece is the input itself, which
// strips anything that is not a digit (M05.02).

const SEARCH_PATH = "/customers";

type Search = { mobile?: SearchValue };

export default async function FindCustomerPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireUser();
  const typed = firstParam((await searchParams).mobile);
  const t = await getTranslations("customers");
  const locale = (await getLocale()) as Locale;

  const searched = typed !== undefined && typed.trim() !== "";
  const mobile = searched ? normalizeMobile(typed) : null;
  const invalid = searched && mobile === null;

  const found = mobile ? await findByMobile(mobile) : null;
  const recent = searched ? [] : await recentlyHandledBy(user.id);

  return (
    <AppShell role={user.role} title={t("title")}>
      <form method="get" action={SEARCH_PATH} className="flex flex-col gap-4">
        <MobileInput
          label={t("fields.mobile")}
          hint={t("hints.mobile")}
          defaultValue={typed ?? ""}
          autoFocus
        />
        <Button type="submit">
          <Search aria-hidden />
          {t("search")}
        </Button>
      </form>

      {invalid && <FieldError>{t("errors.mobileInvalid")}</FieldError>}

      {mobile && found && <FoundCard customer={found} locale={locale} />}

      {mobile && !found && (
        <Card className="flex flex-col gap-3 p-4">
          <p className="font-heading-style text-[17px]">
            {t("notFound", { mobile: formatMobile(mobile) })}
          </p>
          <p className="text-sm text-muted-foreground">{t("notFoundText")}</p>
          <Button asChild>
            <Link href={`${SEARCH_PATH}/new?mobile=${mobile}`}>
              <UserPlus aria-hidden />
              {t("create")}
            </Link>
          </Button>
        </Card>
      )}

      {!searched && (
        <section className="flex flex-col gap-2.5">
          <h2 className="font-heading-style text-lg">{t("recent")}</h2>
          {recent.length === 0 ? (
            <Card>
              <EmptyState title={t("emptyRecent")} text={t("emptyRecentText")} />
            </Card>
          ) : (
            recent.map((customer) => (
              <Link
                key={customer.id}
                href={`${SEARCH_PATH}/${customer.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left no-underline hover:bg-black/2"
              >
                <Avatar name={customer.name} />
                <span className="min-w-0 grow">
                  <span className="block font-bold">{customer.name}</span>
                  {customer.subtitle && (
                    <span className="block truncate text-sm text-muted-foreground">
                      {customer.subtitle}
                    </span>
                  )}
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            ))
          )}
        </section>
      )}
    </AppShell>
  );
}

async function FoundCard({ customer, locale }: { customer: CustomerCard; locale: Locale }) {
  const t = await getTranslations("customers");

  return (
    <Card className="flex flex-col gap-3.5 border-primary p-4">
      <div>
        <Pill tone="green">{t("existing")}</Pill>
      </div>

      <div className="flex items-center gap-3">
        <Avatar name={customer.name} size="lg" />
        <div className="min-w-0">
          <p className="font-heading-style text-lg">{customer.name}</p>
          <p className="text-sm text-muted-foreground">
            {t("visits", { count: customer.visitCount })}
            {customer.lastVisitAt &&
              ` · ${t("lastVisit", {
                date: formatDate(customer.lastVisitAt, locale),
              })}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("handledBy", { name: customer.assignedToName })}
          </p>
        </div>
      </div>

      {customer.openEnquiryTitle && (
        <p className="rounded-md bg-primary-light px-3 py-2 text-sm">
          {t("openEnquiry", { title: customer.openEnquiryTitle })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href={`${SEARCH_PATH}/${customer.id}`}>{t("openHistory")}</Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/visits/new?customerId=${customer.id}`}>{t("addVisit")}</Link>
        </Button>
      </div>
    </Card>
  );
}
