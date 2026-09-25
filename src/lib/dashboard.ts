// M12: the Store overview's numbers. Every figure is defined once here, in the words of
// SOW 7.3 / the module prompt, so M13's reports can call the same functions and "the
// numbers match the reports for the same period" holds by construction.
//
// Days are IST calendar days ("2026-09-24"), inclusive at both ends. Columns that are
// @db.Date (dueDate, billDate) compare as UTC midnights (calendarDay); columns that are
// instants (visitAt, completedAt) compare against IST midnights.
import type { Prisma } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";
import { db } from "@/lib/db";
import { dateWhere, instantWhere, type DayRange } from "@/lib/dashboard-period";
import { addDays } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { localizedName } from "@/lib/localized-name";
import { branchWhere, type BranchScope } from "@/lib/permissions";
import { staffBranchWhere } from "@/lib/staff-scope";

// "Overdue by more than 3 days" (M12.04) and "red if 3+" in the table.
export const LONG_OVERDUE_DAYS = 3;
export const OVERDUE_WARN = 3;
export const ALERT_ROWS = 10;

export type PersonRow = {
  id: string;
  name: string;
  active: boolean;
  departmentId: string | null;
  visits: number;
  newCustomers: number; // unique customers of theirs with a NEW visit in the period
  notInterested: number; // enquiries they closed as not interested
  due: number;
  done: number;
  overdue: number;
  sales: number;
  conversions: number;
  // conversions ÷ (their sales + their not-interested closures) × 100; null if none closed
  conversionPercent: number | null;
};

export type Overview = {
  visited: { total: number; new: number; existing: number };
  sales: { total: number; fromFollowUps: number };
  due: { total: number; done: number };
  overdue: number;
  notInterested: { total: number; topReason: string | null };
  // Follow-up conversions ÷ enquiries closed in the period × 100 (SOW 7.3); null when
  // nothing closed. An enquiry closes with a sale or with "not interested".
  conversionPercent: number | null;
  people: PersonRow[];
};

type Counts = Map<string, number>;

// Follow-up conversions ÷ enquiries closed × 100, whole percent; null when none closed.
export function percent(conversions: number, closed: number): number | null {
  return closed > 0 ? Math.round((conversions / closed) * 100) : null;
}
const add = (map: Counts, key: string, by: number) => map.set(key, (map.get(key) ?? 0) + by);

// SOW 7.3 / module prompt definitions, for the branches in `scope`:
// - Customers visited: unique customers with a visit in the period; New/Existing splits
//   them by visit type (BR-13) — one NEW visit in the period makes the customer new.
// - Sales completed: not cancelled, bill date in the period. From follow-ups: those that
//   count as follow-up conversions (BR-11, stored on the sale as fromFollowUp).
// - Follow-ups due: due date in the period, any status but RESCHEDULED / CANCELLED.
//   Done: of those, DONE.
// - Overdue: PENDING with a due date before today — always as of now, not the period.
// - Not interested: enquiries closed as not interested in the period — by a visit or by a
//   follow-up call, which is where the branch and the salesperson are recorded.
// Per person: visits they recorded, follow-ups assigned to them, sales credited to them.
export async function loadOverview(
  scope: BranchScope,
  range: DayRange,
  today: string,
  locale: Locale,
): Promise<Overview> {
  const branch = branchWhere(scope);
  const instants = instantWhere(range);
  const dates = dateWhere(range);

  const [visitsBy, visitors, newBy, salesBy, dueBy, overdueBy, lostVisits, lostCalls, staff] =
    await Promise.all([
      db.visit.groupBy({
        by: ["salespersonId"],
        where: { ...branch, visitAt: instants },
        _count: { _all: true },
      }),
      db.visit.groupBy({
        by: ["customerId", "visitType"],
        where: { ...branch, visitAt: instants },
      }),
      db.visit.groupBy({
        by: ["salespersonId", "customerId"],
        where: { ...branch, visitAt: instants, visitType: "NEW" },
      }),
      db.sale.groupBy({
        by: ["salespersonId", "fromFollowUp"],
        where: { ...branch, billDate: dates, cancelled: false },
        _count: { _all: true },
      }),
      db.followUp.groupBy({
        by: ["assignedToId", "status"],
        where: { ...branch, dueDate: dates, status: { in: ["PENDING", "DONE"] } },
        _count: { _all: true },
      }),
      db.followUp.groupBy({
        by: ["assignedToId"],
        where: { ...branch, status: "PENDING", dueDate: { lt: calendarDay(today) } },
        _count: { _all: true },
      }),
      db.visit.groupBy({
        by: ["salespersonId", "lostReasonId"],
        where: { ...branch, visitAt: instants, outcome: "NOT_INTERESTED" },
        _count: { _all: true },
      }),
      db.followUp.findMany({
        where: { ...branch, result: "NOT_INTERESTED", completedAt: instants },
        select: { completedById: true, enquiry: { select: { lostReasonId: true } } },
      }),
      // Every active salesperson of these branches gets a row, even on a quiet day.
      db.user.findMany({
        where: { ...staffBranchWhere(scope), role: "SALESPERSON", status: "ACTIVE" },
        select: { id: true },
      }),
    ]);

  // Customers visited, split new / existing.
  const isNew = new Map<string, boolean>();
  for (const row of visitors) {
    isNew.set(row.customerId, (isNew.get(row.customerId) ?? false) || row.visitType === "NEW");
  }
  const newCustomers = [...isNew.values()].filter(Boolean).length;

  // Per person.
  const visits: Counts = new Map();
  const due: Counts = new Map();
  const done: Counts = new Map();
  const overdue: Counts = new Map();
  const sales: Counts = new Map();
  const conversions: Counts = new Map();
  for (const row of visitsBy) add(visits, row.salespersonId, row._count._all);
  for (const row of dueBy) {
    add(due, row.assignedToId, row._count._all);
    if (row.status === "DONE") add(done, row.assignedToId, row._count._all);
  }
  for (const row of overdueBy) add(overdue, row.assignedToId, row._count._all);
  for (const row of salesBy) {
    add(sales, row.salespersonId, row._count._all);
    if (row.fromFollowUp) add(conversions, row.salespersonId, row._count._all);
  }

  const newCustomersBy: Counts = new Map();
  for (const row of newBy) add(newCustomersBy, row.salespersonId, 1);

  // Not interested, and its most common reason.
  const reasons: Counts = new Map();
  const lostBy: Counts = new Map();
  for (const row of lostVisits) {
    if (row.lostReasonId) add(reasons, row.lostReasonId, row._count._all);
    add(lostBy, row.salespersonId, row._count._all);
  }
  for (const row of lostCalls) {
    if (row.enquiry.lostReasonId) add(reasons, row.enquiry.lostReasonId, 1);
    if (row.completedById) add(lostBy, row.completedById, 1);
  }
  const lostTotal = lostVisits.reduce((sum, row) => sum + row._count._all, 0) + lostCalls.length;
  const [topReasonId] = [...reasons].sort((a, b) => b[1] - a[1])[0] ?? [];

  const ids = new Set([
    ...staff.map((person) => person.id),
    ...visits.keys(),
    ...due.keys(),
    ...overdue.keys(),
    ...sales.keys(),
    ...lostBy.keys(),
  ]);
  const [people, topReason] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, fullName: true, status: true, departmentId: true },
      orderBy: { fullName: "asc" },
    }),
    topReasonId
      ? db.lostReason.findUnique({
          where: { id: topReasonId },
          select: { nameEn: true, nameHi: true, nameGu: true },
        })
      : null,
  ]);

  const sum = (map: Counts) => [...map.values()].reduce((total, n) => total + n, 0);
  const salesTotal = sum(sales);
  const fromFollowUps = sum(conversions);
  const closed = salesTotal + lostTotal;

  return {
    visited: { total: isNew.size, new: newCustomers, existing: isNew.size - newCustomers },
    sales: { total: salesTotal, fromFollowUps },
    due: { total: sum(due), done: sum(done) },
    overdue: sum(overdue),
    notInterested: {
      total: lostTotal,
      topReason: topReason ? localizedName(topReason, locale) : null,
    },
    conversionPercent: percent(fromFollowUps, closed),
    people: people.map((person) => ({
      id: person.id,
      name: person.fullName,
      active: person.status === "ACTIVE",
      departmentId: person.departmentId,
      visits: visits.get(person.id) ?? 0,
      newCustomers: newCustomersBy.get(person.id) ?? 0,
      notInterested: lostBy.get(person.id) ?? 0,
      due: due.get(person.id) ?? 0,
      done: done.get(person.id) ?? 0,
      overdue: overdue.get(person.id) ?? 0,
      sales: sales.get(person.id) ?? 0,
      conversions: conversions.get(person.id) ?? 0,
      conversionPercent: percent(
        conversions.get(person.id) ?? 0,
        (sales.get(person.id) ?? 0) + (lostBy.get(person.id) ?? 0),
      ),
    })),
  };
}

const ALERT_SELECT = {
  id: true,
  dueDate: true,
  notReachableCount: true,
  customer: { select: { id: true, name: true } },
  assignedTo: { select: { fullName: true } },
} satisfies Prisma.FollowUpSelect;

export type AlertFollowUp = Prisma.FollowUpGetPayload<{ select: typeof ALERT_SELECT }>;

export type Alerts = {
  notReachable: { count: number; rows: AlertFollowUp[] };
  longOverdue: { count: number; rows: AlertFollowUp[]; before: string };
  inactiveStaff: { id: string; name: string; followUps: number }[];
};

// M12.04 "Needs attention", as of now: customers not reachable 3 times in a row, pending
// follow-ups more than 3 days late, and inactive staff still holding pending follow-ups
// (left from before M15, or moved there by a data fix — the reassign screen clears them).
export async function loadAlerts(scope: BranchScope, today: string): Promise<Alerts> {
  const branch = branchWhere(scope);
  const pending = { ...branch, status: "PENDING" as const };
  const before = addDays(today, -LONG_OVERDUE_DAYS);
  const notReachableWhere = { ...pending, notReachableCount: { gte: 3 } };
  const longOverdueWhere = { ...pending, dueDate: { lt: calendarDay(before) } };

  const [notReachableCount, notReachable, longOverdueCount, longOverdue, inactive] =
    await Promise.all([
      db.followUp.count({ where: notReachableWhere }),
      db.followUp.findMany({
        where: notReachableWhere,
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: ALERT_ROWS,
        select: ALERT_SELECT,
      }),
      db.followUp.count({ where: longOverdueWhere }),
      db.followUp.findMany({
        where: longOverdueWhere,
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: ALERT_ROWS,
        select: ALERT_SELECT,
      }),
      db.followUp.groupBy({
        by: ["assignedToId"],
        where: { ...pending, assignedTo: { status: "INACTIVE" } },
        _count: { _all: true },
      }),
    ]);

  const names = await db.user.findMany({
    where: { id: { in: inactive.map((row) => row.assignedToId) } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const heldBy = new Map(inactive.map((row) => [row.assignedToId, row._count._all]));

  return {
    notReachable: { count: notReachableCount, rows: notReachable },
    longOverdue: { count: longOverdueCount, rows: longOverdue, before },
    inactiveStaff: names.map((person) => ({
      id: person.id,
      name: person.fullName,
      followUps: heldBy.get(person.id) ?? 0,
    })),
  };
}
