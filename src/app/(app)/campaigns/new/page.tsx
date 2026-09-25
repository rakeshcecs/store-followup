import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { CampaignForm } from "@/app/(app)/campaigns/new/campaign-form";
import { AppShell } from "@/components/layout/app-shell";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { getBranchScope, getCurrentBranch, switchableBranches } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { upcomingFestivals } from "@/lib/festivals";
import { formatDate, isoDate } from "@/lib/format";
import { localizedName } from "@/lib/localized-name";
import { ALL_BRANCHES, isAdmin } from "@/lib/permissions";
import { whatsappConnection } from "@/lib/whatsapp/settings";

// M23 "Create campaign": name and branch, an approved message and what fills it, the
// customers, a preview of who gets it, and when. One screen, five numbered parts.
export default async function NewCampaignPage() {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const t = await getTranslations("campaigns");
  const locale = (await getLocale()) as Locale;
  const [branches, choice, scope] = await Promise.all([
    switchableBranches(user),
    getCurrentBranch(user),
    getBranchScope(user),
  ]);
  const today = isoDate(new Date());
  const [templates, categories, departments, reasons, festivals, connected] = await Promise.all([
    db.whatsAppTemplate.findMany({
      where: { active: true, metaStatus: "APPROVED" },
      orderBy: [{ name: "asc" }, { language: "asc" }],
      select: { id: true, name: true, language: true, body: true, variables: true, mapping: true },
    }),
    db.requirementCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: { id: true, nameEn: true, nameHi: true, nameGu: true },
    }),
    db.department.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.lostReason.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: { id: true, nameEn: true, nameHi: true, nameGu: true },
    }),
    upcomingFestivals(scope, today),
    whatsappConnection().then((connection) => connection !== null),
  ]);

  const branchOptions = [
    ...(isAdmin(user) ? [{ value: ALL_BRANCHES, label: t("allBranches") }] : []),
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ];

  return (
    <AppShell role={user.role} title={t("new")} backHref="/campaigns" backLabel={t("back")}>
      {!connected && (
        <p className="rounded-md bg-warning-light px-3 py-2.5 text-sm text-warning" role="status">
          {t("notConnected")}
        </p>
      )}
      <CampaignForm
        branches={branchOptions}
        defaultBranch={choice === ALL_BRANCHES ? ALL_BRANCHES : choice}
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
          language: template.language,
          body: template.body,
          variables: Array.isArray(template.variables) ? (template.variables as string[]) : [],
          mapping: (template.mapping ?? {}) as Record<string, string>,
        }))}
        categories={categories.map((c) => ({ value: c.id, label: localizedName(c, locale) }))}
        departments={departments.map((d) => ({ value: d.id, label: d.name }))}
        reasons={reasons.map((r) => ({ value: r.id, label: localizedName(r, locale) }))}
        festivals={festivals.map((festival) => ({
          id: festival.id,
          name: festival.name,
          date: isoDate(festival.date),
          label: `${festival.name} · ${formatDate(festival.date, locale)}`,
        }))}
      />
    </AppShell>
  );
}
