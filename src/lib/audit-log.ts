// M16 audit log screen: who did what, read only, for managers and admins. The rows are
// written by writeAudit() (src/lib/audit.ts) inside the transaction of every change.
//
// branch-scope-exempt: the sale / visit / follow-up lookups here only turn ids already
// read from the (branch-filtered) audit rows, or a searched mobile or bill number, into
// the audit rows' entity ids; nothing from those tables is shown.
import { z } from "zod";
import { isRealDay } from "@/lib/validation/common";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import { AUDIT } from "@/lib/audit";
import { addDays, daysBetween } from "@/lib/follow-up-dates";
import { instantWhere, type DayRange } from "@/lib/dashboard-period";
import { db } from "@/lib/db";
import { normalizeMobile } from "@/lib/mobile";
import type { BranchScope } from "@/lib/permissions";
import { staffBranchWhere } from "@/lib/staff-scope";

// The module prompt's action list. Every stored action name falls into one of them.
export const AUDIT_KINDS = [
  "CREATE",
  "UPDATE",
  "CANCEL",
  "DELETE",
  "EXPORT",
  "LOGIN_LOCK",
  "REASSIGN",
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export function auditKind(action: string): AuditKind {
  const verb = action.split(":")[1] ?? "";
  if (verb === "create") return "CREATE";
  if (verb === "cancel") return "CANCEL";
  if (verb === "delete" || verb === "anonymize") return "DELETE";
  if (verb === "export") return "EXPORT";
  if (verb === "locked") return "LOGIN_LOCK";
  if (verb === "reassign") return "REASSIGN";
  return "UPDATE"; // edits, status changes, results, reschedules, PIN changes, settings
}

export function actionsOfKind(kind: AuditKind): string[] {
  return Object.values(AUDIT).filter((action) => auditKind(action) === kind);
}

export const AUDIT_ENTITIES = [
  "Customer",
  "Visit",
  "FollowUp",
  "Enquiry",
  "Sale",
  "User",
  "Branch",
  "Department",
  "RequirementCategory",
  "LostReason",
  "Setting",
  "Report",
  "ImportJob",
  "WhatsAppMessage",
  "WhatsAppTemplate",
  // M23
  "Campaign",
  "Festival",
] as const;

export const AUDIT_PAGE_SIZE = 50;
// The screen opens on the last 30 days; any range up to the 3 years the log is kept.
export const AUDIT_DEFAULT_DAYS = 30;
export const AUDIT_MAX_DAYS = 3 * 366;

const day = z.string().refine(isRealDay);
const filtersSchema = z.object({
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  user: z.string().trim().min(1).max(40).optional().catch(undefined),
  entity: z.enum(AUDIT_ENTITIES).optional().catch(undefined),
  kind: z.enum(AUDIT_KINDS).optional().catch(undefined),
  q: z.string().trim().min(1).max(30).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type AuditFilters = z.infer<typeof filtersSchema> & { range: DayRange };

export function parseAuditFilters(
  params: Record<string, string | string[] | undefined>,
  today: string,
): AuditFilters {
  const flat = Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => {
      const first = Array.isArray(value) ? value[0] : value;
      return first ? [[key, first]] : [];
    }),
  );
  const f = filtersSchema.parse(flat);
  const fallback = { from: addDays(today, -(AUDIT_DEFAULT_DAYS - 1)), to: today };
  const from = f.from ?? fallback.from;
  const to = f.to ?? today;
  const days = daysBetween(from, to);
  const range = days < 0 || days > AUDIT_MAX_DAYS ? fallback : { from, to };
  return { ...f, range };
}

// A manager reads the rows of the branches on screen, and whatever they did themselves
// (an edit to a customer of another branch lands on that customer's home branch). An
// admin on "All branches" reads everything, including store-wide rows with no branch.
export function auditScopeWhere(user: SessionUser, scope: BranchScope): Prisma.AuditLogWhereInput {
  if (scope.all) return {};
  const branches = { branchId: { in: scope.branchIds } };
  return user.role === "ADMIN" ? branches : { OR: [branches, { userId: user.id }] };
}

// "9825012345" finds everything about that customer; "B-1043" everything about that
// bill; an empty list when nothing matched, so no rows. Exact matches only (M05.04).
async function searchedIds(q: string): Promise<string[]> {
  const ids: string[] = [];
  const mobile = normalizeMobile(q);
  if (mobile) {
    const customer = await db.customer.findFirst({
      where: { OR: [{ mobile }, { altMobile: mobile }] },
      select: {
        id: true,
        enquiries: { select: { id: true } },
        visits: { select: { id: true } },
        followUps: { select: { id: true } },
        sales: { select: { id: true } },
      },
    });
    if (customer) {
      ids.push(customer.id);
      for (const list of [customer.enquiries, customer.visits, customer.followUps, customer.sales])
        ids.push(...list.map((row) => row.id));
    }
  }
  const sales = await db.sale.findMany({
    where: { billNumber: q.toUpperCase() },
    select: { id: true },
  });
  ids.push(...sales.map((sale) => sale.id));
  return ids;
}

export type AuditRow = {
  id: string;
  at: Date;
  action: string;
  kind: AuditKind;
  entityType: string;
  entityId: string;
  userName: string | null; // null = the system
  device: string | null;
  // Where the row's record lives, and the customer it is about, when there is one.
  href: string | null;
  customerName: string | null;
  changes: Change[];
};

export type Change = { field: string; from: string | null; to: string | null };

// Bookkeeping fields every row has; they say nothing about the change.
const SKIP = new Set(["id", "createdAt", "updatedAt", "clientId", "createdById", "updatedById"]);
const MAX_TEXT = 80;

function show(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

// "", null and a missing field all mean "nothing there".
const same = (value: unknown) =>
  value === null || value === undefined || value === "" ? "null" : JSON.stringify(value);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

// Old and new values side by side, one line per field that differs. A create has only
// new values; a status change often only the fields it touched.
export function auditChanges(oldValue: unknown, newValue: unknown): Change[] {
  const before = asRecord(oldValue);
  const after = asRecord(newValue);
  if (!before && !after) {
    return oldValue === null && newValue === null
      ? []
      : [{ field: "", from: show(oldValue), to: show(newValue) }];
  }
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys
    .filter((key) => !SKIP.has(key))
    .filter((key) => same(before?.[key]) !== same(after?.[key]))
    .map((key) => ({ field: key, from: show(before?.[key]), to: show(after?.[key]) }));
}

export type AuditPage = { rows: AuditRow[]; total: number; page: number; pages: number };

export async function loadAuditLog(
  user: SessionUser,
  scope: BranchScope,
  filters: AuditFilters,
): Promise<AuditPage> {
  const ids = filters.q ? await searchedIds(filters.q) : null;
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      auditScopeWhere(user, scope),
      { createdAt: instantWhere(filters.range) },
      filters.user ? { userId: filters.user } : {},
      filters.entity ? { entityType: filters.entity } : {},
      filters.kind ? { action: { in: actionsOfKind(filters.kind) } } : {},
      ids ? { entityId: { in: ids } } : {},
    ],
  };
  const total = await db.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
  });

  const byType = (type: string) =>
    rows.filter((row) => row.entityType === type).map((row) => row.entityId);
  const userIds = [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
  const [users, customers, visits, followUps, sales, enquiries] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
    db.customer.findMany({ where: { id: { in: byType("Customer") } }, select: CUSTOMER }),
    db.visit.findMany({ where: { id: { in: byType("Visit") } }, select: OF_CUSTOMER }),
    db.followUp.findMany({ where: { id: { in: byType("FollowUp") } }, select: OF_CUSTOMER }),
    db.sale.findMany({ where: { id: { in: byType("Sale") } }, select: OF_CUSTOMER }),
    db.enquiry.findMany({ where: { id: { in: byType("Enquiry") } }, select: OF_CUSTOMER }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  const owner = new Map<string, Customer>();
  for (const c of customers) owner.set(c.id, c);
  for (const list of [visits, followUps, sales, enquiries])
    for (const row of list) owner.set(row.id, row.customer);

  return {
    total,
    page,
    pages,
    rows: rows.map((row) => {
      const customer = owner.get(row.entityId) ?? null;
      const href =
        row.entityType === "FollowUp" && customer?.active
          ? `/follow-ups/${row.entityId}`
          : customer?.active
            ? `/customers/${customer.id}`
            : null;
      return {
        id: row.id,
        at: row.createdAt,
        action: row.action,
        kind: auditKind(row.action),
        entityType: row.entityType,
        entityId: row.entityId,
        userName: row.userId ? (names.get(row.userId) ?? null) : null,
        device: row.device,
        href,
        customerName: customer?.name ?? null,
        changes: auditChanges(row.oldValue, row.newValue),
      };
    }),
  };
}

const CUSTOMER = { id: true, name: true, active: true } as const;
const OF_CUSTOMER = { id: true, customer: { select: CUSTOMER } } as const;
type Customer = { id: string; name: string; active: boolean };

// The people a reader may pick in the "User" filter: staff of the branches on screen.
export async function auditUsers(scope: BranchScope) {
  return db.user.findMany({
    where: staffBranchWhere(scope),
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
}
