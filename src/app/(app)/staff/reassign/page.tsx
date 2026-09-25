import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ReassignForm } from "@/app/(app)/staff/reassign/reassign-form";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/current-branch";
import { formatDayDate } from "@/lib/format";
import { openCustomersOf, reassignSources, reassignTargets } from "@/lib/reassign";

type Search = { from?: string; customer?: string; exit?: string };

// M15: Reassign customers (Manager, Admin). "From" lists whoever in the switcher's
// branches still holds customers or pending follow-ups; "To" active salespeople only.
//
// Reached three ways, all by URL so a link can carry the choice:
// - the Staff screen's button (nothing chosen);
// - a customer's profile, "Change salesperson" (?from=owner&customer=id, just that one);
// - deactivating someone who still holds work (?from=id&exit=1, admin only), which moves
//   everything and then makes them inactive (M15.02).
export default async function ReassignPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const params = await searchParams;
  const t = await getTranslations("reassign");
  const tFollowUps = await getTranslations("followUps");
  const locale = (await getLocale()) as Locale;
  const scope = await getBranchScope(user);

  const [sources, targets] = await Promise.all([reassignSources(scope), reassignTargets(scope)]);
  const from = sources.find((person) => person.id === params.from) ?? null;
  const rows = from ? await openCustomersOf(from.id) : [];
  const only = params.customer && rows.some((row) => row.id === params.customer);
  const exit = user.role === "ADMIN" && params.exit === "1" && from !== null && from.active;

  return (
    <AppShell role={user.role} title={t("title")} backHref="/staff" backLabel={t("back")}>
      {exit && from && (
        <Card className="border-warning p-4 text-[15px]">
          {t("exitIntro", { name: from.fullName })}
        </Card>
      )}

      {sources.length === 0 ? (
        <Card>
          <EmptyState title={t("nobody")} text={t("nobodyText")} />
        </Card>
      ) : (
        <ReassignForm
          // A new person, a new list: nothing ticked for the previous one survives.
          key={from?.id ?? "none"}
          sources={sources.map((person) => ({
            value: person.id,
            label: person.active
              ? t("fromOption", { name: person.fullName, count: person.customers })
              : t("fromOptionInactive", { name: person.fullName, count: person.customers }),
          }))}
          from={from ? { id: from.id, name: from.fullName } : null}
          targets={targets
            .filter((person) => person.id !== from?.id)
            .map((person) => ({ value: person.id, label: person.fullName }))}
          rows={rows.map((row) => ({
            id: row.id,
            name: row.name,
            followUps: row.followUps,
            detail: [
              row.requirement,
              row.nextFollowUp
                ? t("nextFollowUp", {
                    date: formatDayDate(row.nextFollowUp.dueDate, locale),
                    slot: tFollowUps(`slotWord.${row.nextFollowUp.timeSlot}`),
                  })
                : t("noFollowUp"),
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
          preselected={only ? [params.customer!] : exit ? rows.map((row) => row.id) : []}
          backTo={only ? `/customers/${params.customer}` : null}
          exit={exit}
        />
      )}
    </AppShell>
  );
}
