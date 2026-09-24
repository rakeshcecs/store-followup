// The scheduled reminders and summaries (M14). Each one writes Notification rows — the
// bell list — and the worker then pushes whatever has not been pushed yet
// (src/lib/push.ts). Rows hold ids and numbers only; the text is made in the reader's
// language when it is shown (src/lib/notification-text.ts).
//
// branch-scope-exempt: these run in the worker, for everyone at once, with no signed-in
// user. A salesperson's reminder covers their own follow-ups in every branch (the same
// rule as followUpAccessWhere); a manager's summary is filtered to each branch by id
// below, and only an admin gets the all-branches total.
import type { TimeSlot } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate, istMinute } from "@/lib/format";
import type { JobPayloads, JobType } from "@/lib/jobs/types";
import type { ReminderTimes } from "@/lib/validation/reminders";

export const NOTIFICATION = {
  morning: "summary-morning",
  slot: "reminder-slot",
  manager: "summary-manager",
} as const;

// How many customer names a slot reminder carries: "Rajesh Patel, Neha Shah and 1 more".
export const SLOT_NAMES_SHOWN = 2;

type Due = { [K in JobType]: { type: K; payload: JobPayloads[K]; singletonKey: string } }[JobType];

// Which jobs start this minute. Pure: the worker's one-minute tick calls it with the
// times read from Settings, so a changed time takes effect on the next minute. The
// singletonKey (job + IST date + slot) keeps a restart or a second worker from sending
// a reminder twice.
export function dueReminders(times: ReminderTimes, now: Date): Due[] {
  const minute = istMinute(now);
  const date = isoDate(now);
  const due: Due[] = [];
  if (times.morningSummary === minute) {
    due.push({
      type: "reminders-morning",
      payload: { date },
      singletonKey: `reminders-morning:${date}`,
    });
  }
  const slots: [TimeSlot, string][] = [
    ["MORNING", times.slotMorning],
    ["AFTERNOON", times.slotAfternoon],
    ["EVENING", times.slotEvening],
  ];
  for (const [slot, at] of slots) {
    if (at === minute) {
      due.push({
        type: "reminders-slot",
        payload: { date, slot },
        singletonKey: `reminders-slot:${date}:${slot}`,
      });
    }
  }
  if (times.managerSummary === minute) {
    due.push({
      type: "summary-manager",
      payload: { date },
      singletonKey: `summary-manager:${date}`,
    });
  }
  return due;
}

type NewNotification = { userId: string; type: string; message: string; link: string };

// Writes the rows that are not there yet. `prefix` identifies "this reminder for this
// user today", so a retried job adds only what the failed run did not.
async function writeOnce(rows: (NewNotification & { prefix: string })[]): Promise<number> {
  let written = 0;
  for (const { prefix, ...row } of rows) {
    const exists = await db.notification.findFirst({
      where: { userId: row.userId, type: row.type, message: { startsWith: prefix } },
      select: { id: true },
    });
    if (exists) continue;
    await db.notification.create({ data: row });
    written += 1;
  }
  return written;
}

const activeSalespeople = () =>
  db.user.findMany({ where: { role: "SALESPERSON", status: "ACTIVE" }, select: { id: true } });

// M14.02: "Good morning! You have 5 follow-ups today and 2 overdue." Skipped when both
// are 0 (module prompt).
export async function createMorningSummaries(date: string): Promise<number> {
  const day = calendarDay(date);
  const people = await activeSalespeople();
  const ids = people.map((person) => person.id);
  const [today, overdue] = await Promise.all([
    db.followUp.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { in: ids }, status: "PENDING", dueDate: day },
      _count: { _all: true },
    }),
    db.followUp.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { in: ids }, status: "PENDING", dueDate: { lt: day } },
      _count: { _all: true },
    }),
  ]);
  const count = (rows: typeof today, id: string) =>
    rows.find((row) => row.assignedToId === id)?._count._all ?? 0;

  const prefix = `${NOTIFICATION.morning}:${date}:`;
  return writeOnce(
    ids
      .map((userId) => ({ userId, today: count(today, userId), overdue: count(overdue, userId) }))
      .filter((person) => person.today > 0 || person.overdue > 0)
      .map((person) => ({
        userId: person.userId,
        type: NOTIFICATION.morning,
        message: `${prefix}${person.today}:${person.overdue}`,
        link: "/today",
        prefix,
      })),
  );
}

// M14.03: at the start of each slot, that slot's follow-ups for today. One follow-up
// opens straight on its Update screen; more open Today.
export async function createSlotReminders(date: string, slot: TimeSlot): Promise<number> {
  const people = await activeSalespeople();
  const followUps = await db.followUp.findMany({
    where: {
      assignedToId: { in: people.map((person) => person.id) },
      status: "PENDING",
      dueDate: calendarDay(date),
      timeSlot: slot,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, assignedToId: true },
  });

  const byPerson = new Map<string, string[]>();
  for (const followUp of followUps) {
    byPerson.set(followUp.assignedToId, [
      ...(byPerson.get(followUp.assignedToId) ?? []),
      followUp.id,
    ]);
  }

  const prefix = `${NOTIFICATION.slot}:${date}:${slot}:`;
  return writeOnce(
    [...byPerson].map(([userId, ids]) => ({
      userId,
      type: NOTIFICATION.slot,
      message: `${prefix}${ids.length}:${ids.slice(0, SLOT_NAMES_SHOWN).join(",")}`,
      link: ids.length === 1 ? `/follow-ups/${ids[0]}` : "/today",
      prefix,
    })),
  );
}

export type DaySummary = {
  visits: number;
  sales: number;
  done: number;
  due: number;
  overdue: number;
};

// M14.04 for one branch, or every branch when branchIds is null: today's visits, sales
// (not cancelled), follow-ups due today and how many of those are done, and what is
// overdue right now.
export async function daySummary(date: string, branchIds: string[] | null): Promise<DaySummary> {
  const day = calendarDay(date);
  const branch = branchIds ? { branchId: { in: branchIds } } : {};
  // The IST day as UTC instants: visits carry a time, not a calendar date.
  const start = new Date(`${date}T00:00:00.000+05:30`);
  const end = new Date(`${addDays(date, 1)}T00:00:00.000+05:30`);
  const [visits, sales, done, due, overdue] = await Promise.all([
    db.visit.count({ where: { ...branch, visitAt: { gte: start, lt: end } } }),
    db.sale.count({ where: { ...branch, billDate: day, cancelled: false } }),
    db.followUp.count({ where: { ...branch, dueDate: day, status: "DONE" } }),
    // Due today = still pending or done; a rescheduled or cancelled one is no longer due.
    db.followUp.count({ where: { ...branch, dueDate: day, status: { in: ["PENDING", "DONE"] } } }),
    db.followUp.count({ where: { ...branch, status: "PENDING", dueDate: { lt: day } } }),
  ]);
  return { visits, sales, done, due, overdue };
}

const summaryMessage = (prefix: string, s: DaySummary) =>
  `${prefix}${s.visits}:${s.sales}:${s.done}:${s.due}:${s.overdue}`;

// M14.04: each manager gets one summary per branch they work in (home and extras) — the
// numbers match what they see with that branch in the switcher (M17.06). Every admin
// gets one all-branches total.
export async function createManagerSummaries(date: string): Promise<number> {
  const [branches, managers, admins] = await Promise.all([
    db.branch.findMany({ where: { status: "ACTIVE" }, select: { id: true } }),
    db.user.findMany({
      where: { role: "MANAGER", status: "ACTIVE" },
      select: { id: true, homeBranchId: true, extraBranches: { select: { branchId: true } } },
    }),
    db.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } }),
  ]);

  const rows: (NewNotification & { prefix: string })[] = [];
  for (const branch of branches) {
    const theirs = managers.filter(
      (m) => m.homeBranchId === branch.id || m.extraBranches.some((e) => e.branchId === branch.id),
    );
    if (theirs.length === 0) continue;
    const prefix = `${NOTIFICATION.manager}:${date}:${branch.id}:`;
    const message = summaryMessage(prefix, await daySummary(date, [branch.id]));
    for (const manager of theirs) {
      rows.push({
        userId: manager.id,
        type: NOTIFICATION.manager,
        message,
        link: "/overview",
        prefix,
      });
    }
  }
  if (admins.length > 0) {
    const prefix = `${NOTIFICATION.manager}:${date}:all:`;
    const message = summaryMessage(prefix, await daySummary(date, null));
    for (const admin of admins) {
      rows.push({
        userId: admin.id,
        type: NOTIFICATION.manager,
        message,
        link: "/overview",
        prefix,
      });
    }
  }
  return writeOnce(rows);
}
