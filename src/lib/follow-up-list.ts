// The follow-up lists (M11): the rows behind the Today cards and the Follow-ups screen.
// Every function takes "today" or "now" from the caller, so tests run on a fixed clock
// and a follow-up can be walked from Coming up to Today to Overdue without waiting.
import { z } from "zod";
import { isRealDay } from "@/lib/validation/common";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { calendarDay } from "@/lib/follow-ups";
import { daysBetween } from "@/lib/follow-up-dates";
import { isoDate } from "@/lib/format";
import { normalizeMobile } from "@/lib/mobile";
import { branchWhere, type BranchScope } from "@/lib/permissions";

// What a follow-up card shows: who, what they want, when, why, and how to reach them.
export const FOLLOW_UP_ROW = {
  id: true,
  dueDate: true,
  timeSlot: true,
  method: true,
  reason: true,
  status: true,
  result: true,
  notReachableCount: true,
  createdAt: true,
  customer: { select: { id: true, name: true, mobile: true } },
  enquiry: { select: { title: true } },
  assignedTo: { select: { id: true, fullName: true } },
} satisfies Prisma.FollowUpSelect;

export type FollowUpRow = Prisma.FollowUpGetPayload<{ select: typeof FOLLOW_UP_ROW }>;

// Morning → Afternoon → Evening, then the order they were set in (module prompt M11).
// MySQL sorts an ENUM column by its position in the enum, and TimeSlot is declared in
// day order, so the database does this; tests/db/today.test.ts holds it to that.
export const DAY_ORDER = [
  { dueDate: "asc" },
  { timeSlot: "asc" },
  { createdAt: "asc" },
] satisfies Prisma.FollowUpOrderByWithRelationInput[];

// Where a pending follow-up stands against today (BR-09): late by n days, due today,
// or still ahead.
export type Timing = { kind: "late"; days: number } | { kind: "today" } | { kind: "ahead" };

export function followUpTiming(dueDate: Date, today: string): Timing {
  const days = daysBetween(isoDate(dueDate), today);
  if (days > 0) return { kind: "late", days };
  if (days === 0) return { kind: "today" };
  return { kind: "ahead" };
}

// ---- the Follow-ups screen ----

// Tabs don't overlap: Pending is due today or later, Overdue is before today (BR-09).
// All is every status, rescheduled and cancelled ones included.
export const LIST_TABS = ["pending", "overdue", "done", "all"] as const;
export type ListTab = (typeof LIST_TABS)[number];

// "Show more" asks for 50 more, like the profile history; past 200 the reports (M13) are
// the right tool.
export const LIST_PAGE = 50;
export const LIST_MAX = 200;

const day = z.string().refine(isRealDay);

// Bad or hand-typed values fall back to the default instead of breaking the screen.
const filtersSchema = z.object({
  tab: z.enum(LIST_TABS).catch("pending"),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  assignedTo: z.string().max(36).optional().catch(undefined),
  limit: z.coerce.number().int().min(LIST_PAGE).max(LIST_MAX).catch(LIST_PAGE),
});

export type ListFilters = z.infer<typeof filtersSchema>;

export function parseListFilters(params: Record<string, string | string[] | undefined>) {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) || undefined;
  return filtersSchema.parse({
    tab: first(params["tab"]),
    from: first(params["from"]),
    to: first(params["to"]),
    q: first(params["q"]),
    assignedTo: first(params["assignedTo"]),
    limit: first(params["limit"]),
  });
}

function tabWhere(tab: ListTab, today: Date): Prisma.FollowUpWhereInput {
  switch (tab) {
    case "pending":
      return { status: "PENDING", dueDate: { gte: today } };
    case "overdue":
      return { status: "PENDING", dueDate: { lt: today } };
    case "done":
      return { status: "DONE" };
    case "all":
      return {};
  }
}

// Name or mobile, in whatever shape it was typed: "98765 43210" finds the same customer
// as "9876543210" (same rule as the staff list).
function searchWhere(q: string | undefined): Prisma.FollowUpWhereInput {
  if (!q) return {};
  const digits = normalizeMobile(q) ?? q.replace(/\D/g, "");
  return {
    customer: {
      OR: [{ name: { contains: q } }, ...(digits ? [{ mobile: { contains: digits } }] : [])],
    },
  };
}

const LIST_ORDER: Record<ListTab, Prisma.FollowUpOrderByWithRelationInput[]> = {
  pending: DAY_ORDER,
  overdue: DAY_ORDER, // oldest first, as on Today
  done: [{ completedAt: "desc" }, { createdAt: "desc" }],
  all: [{ dueDate: "desc" }, { createdAt: "desc" }],
};

// A salesperson sees only the follow-ups assigned to them, in every branch they work in
// (the same rule as followUpAccessWhere). A manager or admin sees the branches in the
// switcher, and may narrow to one person.
function listWhere(
  user: SessionUser,
  scope: BranchScope,
  filters: ListFilters,
  tab: ListTab,
  now: Date,
): Prisma.FollowUpWhereInput {
  const who: Prisma.FollowUpWhereInput =
    user.role === "SALESPERSON"
      ? { assignedToId: user.id }
      : {
          ...branchWhere(scope),
          ...(filters.assignedTo ? { assignedToId: filters.assignedTo } : {}),
        };
  return {
    AND: [
      who,
      tabWhere(tab, calendarDay(isoDate(now))),
      filters.from ? { dueDate: { gte: calendarDay(filters.from) } } : {},
      filters.to ? { dueDate: { lte: calendarDay(filters.to) } } : {},
      searchWhere(filters.q),
    ],
  };
}

// How many each tab holds under the same filters, shown on the tabs — so a search that
// finds nothing in Pending still says "Overdue (1)".
export async function countFollowUps(
  user: SessionUser,
  scope: BranchScope,
  filters: ListFilters,
  now: Date,
): Promise<Record<ListTab, number>> {
  const counts = await Promise.all(
    LIST_TABS.map((tab) => db.followUp.count({ where: listWhere(user, scope, filters, tab, now) })),
  );
  return Object.fromEntries(LIST_TABS.map((tab, i) => [tab, counts[i]])) as Record<ListTab, number>;
}

export async function listFollowUps(
  user: SessionUser,
  scope: BranchScope,
  filters: ListFilters,
  now: Date,
): Promise<{ rows: FollowUpRow[]; hasMore: boolean }> {
  const rows = await db.followUp.findMany({
    where: listWhere(user, scope, filters, filters.tab, now),
    select: FOLLOW_UP_ROW,
    orderBy: LIST_ORDER[filters.tab],
    take: filters.limit + 1,
  });
  return { rows: rows.slice(0, filters.limit), hasMore: rows.length > filters.limit };
}
