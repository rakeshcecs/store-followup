import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import type { Locale } from "@/i18n/config";
import {
  AUDIT_ENTITIES,
  AUDIT_KINDS,
  auditUsers,
  loadAuditLog,
  parseAuditFilters,
  type AuditFilters,
  type AuditRow,
} from "@/lib/audit-log";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/current-branch";
import { formatDateTime, isoDate } from "@/lib/format";

type Params = Record<string, string | string[] | undefined>;

// Punctuation, the same in every language.
const SEPARATOR = " · ";
const ARROW = " → ";

// M16 audit log: managers and admins, read only. Filters live in the address (a GET
// form and plain links), like the reports, so a search can be reloaded or shared.
export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  if (user.role === "SALESPERSON") notFound();
  const query = await searchParams;
  const t = await getTranslations("audit");
  const tReports = await getTranslations("reports");
  const locale = (await getLocale()) as Locale;
  const scope = await getBranchScope(user);
  const filters = parseAuditFilters(query, isoDate(new Date()));
  const [log, users] = await Promise.all([loadAuditLog(user, scope, filters), auditUsers(scope)]);

  const href = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first && key !== "page") next.set(key, first);
    }
    next.set("page", String(page));
    return `?${next.toString()}`;
  };

  return (
    <AppShell role={user.role} title={t("title")} backHref="/reports" backLabel={tReports("title")}>
      <p className="text-muted-foreground">{t("intro")}</p>
      <Filters filters={filters} users={users.map((u) => ({ value: u.id, label: u.fullName }))} />
      <p className="text-sm text-muted-foreground" data-testid="audit-count">
        {t("count", { count: log.total })}
      </p>
      {log.rows.length === 0 ? (
        <Card>
          <EmptyState title={t("empty")} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {log.rows.map((row) => (
            <Entry key={row.id} row={row} locale={locale} />
          ))}
        </ul>
      )}
      {log.pages > 1 && (
        <nav className="flex items-center justify-between gap-3">
          {log.page > 1 ? (
            <Link href={href(log.page - 1)} className="font-bold text-primary">
              {t("previous")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            {t("page", { page: log.page, pages: log.pages })}
          </span>
          {log.page < log.pages ? (
            <Link href={href(log.page + 1)} className="font-bold text-primary">
              {t("next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </AppShell>
  );
}

type Option = { value: string; label: string };

async function Filters({ filters, users }: { filters: AuditFilters; users: Option[] }) {
  const t = await getTranslations("audit");
  const any = { value: "", label: t("filters.any") };
  const kinds = AUDIT_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }));
  const entities = AUDIT_ENTITIES.map((entity) => ({
    value: entity,
    label: t(`entities.${entity}`),
  }));
  return (
    <form method="get" className="flex flex-col gap-3" data-testid="audit-filters">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <TextInput
          type="date"
          name="from"
          label={t("filters.from")}
          defaultValue={filters.range.from}
        />
        <TextInput type="date" name="to" label={t("filters.to")} defaultValue={filters.range.to} />
        <Select
          name="user"
          label={t("filters.user")}
          options={[any, ...users]}
          defaultValue={filters.user ?? ""}
        />
        <Select
          name="entity"
          label={t("filters.entity")}
          options={[any, ...entities]}
          defaultValue={filters.entity ?? ""}
        />
        <Select
          name="kind"
          label={t("filters.kind")}
          options={[any, ...kinds]}
          defaultValue={filters.kind ?? ""}
        />
        <TextInput
          name="q"
          label={t("filters.q")}
          hint={t("filters.qHint")}
          defaultValue={filters.q ?? ""}
          autoComplete="off"
        />
      </div>
      <Button type="submit">{t("filters.show")}</Button>
    </form>
  );
}

async function Entry({ row, locale }: { row: AuditRow; locale: Locale }) {
  const t = await getTranslations("audit");
  const actionKey = `actions.${row.action.replace(":", "_")}`;
  const action = t.has(actionKey as "title") ? t(actionKey as "title") : t(`kinds.${row.kind}`);
  const entity = t.has(`entities.${row.entityType}` as "title")
    ? t(`entities.${row.entityType}` as "title")
    : row.entityType;
  const who = row.userName ?? t("system");
  const about = row.customerName ? `${entity}${SEPARATOR}${row.customerName}` : entity;
  const none = t("none");
  return (
    <li>
      <Card className="flex flex-col gap-1.5 p-3.5" data-testid="audit-row">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-bold">{action}</span>
          <span className="text-sm text-muted-foreground">{formatDateTime(row.at, locale)}</span>
        </div>
        <p className="text-[15px]">
          {row.href ? (
            <Link href={row.href} className="font-bold text-primary">
              {about}
            </Link>
          ) : (
            about
          )}
        </p>
        <p className="text-sm text-muted-foreground">{t("by", { name: who })}</p>
        {row.changes.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-bold text-primary">
              {t("changes", { count: row.changes.length })}
            </summary>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
              {row.changes.map((change) => (
                <div key={change.field} className="contents">
                  <dt className="font-bold text-muted-foreground">{change.field}</dt>
                  <dd>{`${change.from ?? none}${ARROW}${change.to ?? none}`}</dd>
                </div>
              ))}
            </dl>
            {row.device && (
              <p className="mt-1.5 text-muted-foreground">{t("device", { device: row.device })}</p>
            )}
          </details>
        )}
      </Card>
    </li>
  );
}
