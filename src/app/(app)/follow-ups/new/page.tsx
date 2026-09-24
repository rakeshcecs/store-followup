import { Building2 } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { FollowUpForm } from "@/app/(app)/follow-ups/new/follow-up-form";
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

// Set follow-up (M08). Reached from Record visit's "No, will decide later", carrying the
// visit as a draft (?draft=…), and from the profile's "Follow-up" (M08.07). Every role
// sets follow-ups (SOW 3.1).
//
// branch-scope-exempt: BR-02 allows one pending follow-up per customer across the whole
// store, so the one this screen would replace is looked up in every branch.
export default async function NewFollowUpPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; draft?: string }>;
}) {
  const user = await requireUser();
  const { customerId, draft } = await searchParams;
  if (!customerId) notFound();
  const t = await getTranslations("followUps");
  const tVisits = await getTranslations("visits");
  const locale = (await getLocale()) as Locale;

  // Customers are shared across branches (BR-16).
  const customer = await db.customer.findFirst({
    where: { id: customerId, active: true },
    select: {
      id: true,
      name: true,
      assignedTo: { select: { fullName: true } },
      enquiries: { where: { status: "OPEN" }, select: { id: true } },
    },
  });
  if (!customer) notFound();

  const shell = (children: ReactNode) => (
    <AppShell
      role={user.role}
      title={t("new")}
      backHref={draft ? `/visits/new?customerId=${customer.id}` : `/customers/${customer.id}`}
      backLabel={t("back")}
    >
      {children}
    </AppShell>
  );

  // A follow-up is written to the branch on screen (BR-16), so not under "All branches".
  if ((await getCurrentBranch(user)) === ALL_BRANCHES) {
    return shell(
      <Card>
        <EmptyState icon={Building2} title={t("pickBranch")} text={t("pickBranchText")} />
      </Card>,
    );
  }

  // M08.06: the one a new follow-up would replace.
  const pending = await db.followUp.findFirst({
    where: { customerId: customer.id, status: "PENDING" },
    select: { dueDate: true },
  });

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
      <FollowUpForm
        userId={user.id}
        customer={{ id: customer.id, name: customer.name }}
        draftId={draft ?? null}
        hasOpenEnquiry={customer.enquiries.length > 0}
        replaces={pending ? formatDayDate(pending.dueDate, locale) : null}
        today={isoDate(now)}
      />
    </>,
  );
}
