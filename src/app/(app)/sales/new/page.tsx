import { Building2 } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SaleForm } from "@/app/(app)/sales/new/sale-form";
import { CustomerStrip } from "@/components/customers/customer-strip";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { formatDayDate, isoDate } from "@/lib/format";
import { ALL_BRANCHES } from "@/lib/permissions";
import { billAmountRequired } from "@/lib/settings";
import { firstParam, type SearchValue } from "@/lib/search-params";

// Sale completed (M10). Reached three ways: from Record visit's "Yes, bought something",
// carrying the visit as a draft (?draft=…), from the profile's "Sale done", and from
// Update follow-up's "Customer already bought" (?followUpId=…, M09.07). Every role
// records sales (SOW 3.1).
export default async function NewSalePage({
  searchParams,
}: {
  searchParams: Promise<{
    customerId?: SearchValue;
    draft?: SearchValue;
    followUpId?: SearchValue;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const customerId = firstParam(params.customerId);
  const draft = firstParam(params.draft);
  const followUpId = firstParam(params.followUpId);
  if (!customerId) notFound();
  const t = await getTranslations("sales");
  const tVisits = await getTranslations("visits");
  const locale = (await getLocale()) as Locale;

  // Customers are shared across branches (BR-16).
  const customer = await db.customer.findFirst({
    where: { id: customerId, active: true },
    select: {
      id: true,
      name: true,
      assignedTo: { select: { fullName: true } },
      enquiries: { where: { status: "OPEN" }, select: { title: true } },
    },
  });
  if (!customer) notFound();

  const shell = (children: ReactNode) => (
    <AppShell
      role={user.role}
      title={t("new")}
      backHref={
        draft
          ? `/visits/new?customerId=${customer.id}`
          : followUpId
            ? `/follow-ups/${followUpId}`
            : `/customers/${customer.id}`
      }
      backLabel={t("back")}
    >
      {children}
    </AppShell>
  );

  // A sale happens in one shop and its bill number is unique in that shop (BR-07), so it
  // cannot be filed under "All branches".
  if ((await getCurrentBranch(user)) === ALL_BRANCHES) {
    return shell(
      <Card>
        <EmptyState icon={Building2} title={t("pickBranch")} text={t("pickBranchText")} />
      </Card>,
    );
  }

  const now = new Date();
  return shell(
    <>
      <CustomerStrip
        name={customer.name}
        line={tVisits("strip", {
          date: formatDayDate(now, locale),
          name: customer.assignedTo.fullName,
        })}
      />
      <SaleForm
        userId={user.id}
        customer={{ id: customer.id, name: customer.name }}
        draftId={draft ?? null}
        followUpId={followUpId ?? null}
        openEnquiryTitle={customer.enquiries[0]?.title ?? null}
        amountRequired={await billAmountRequired()}
        today={isoDate(now)}
      />
    </>,
  );
}
