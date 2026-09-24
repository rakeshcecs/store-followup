// The salesperson's Today screen (M11): "Who should I contact today?"
//
// branch-scope-exempt: a salesperson's own follow-ups and sales count in every branch
// they work in — followUpAccessWhere() is the rule (src/lib/follow-ups.ts), and a sale's
// credit goes to the person on it (BR-12).
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { DAY_ORDER, FOLLOW_UP_ROW, type FollowUpRow } from "@/lib/follow-up-list";
import { calendarDay, followUpAccessWhere } from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";

// "Coming up" covers the next 7 days (M11.07).
export const COMING_UP_DAYS = 7;

// The overdue list stops here; the count above it stays exact, and the Follow-ups
// screen's Overdue tab shows the rest.
export const OVERDUE_SHOWN = 100;

export type GreetingKey = "morning" | "afternoon" | "evening";

// Good morning until 12, Good afternoon until 5 PM, then Good evening (module prompt).
export function greetingKey(hour: number): GreetingKey {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export type TodayData = {
  today: string;
  counts: { dueToday: number; overdue: number; salesToday: number };
  overdue: FollowUpRow[];
  dueToday: FollowUpRow[];
  comingUp: FollowUpRow[];
};

// BR-09: a pending follow-up due before today is Overdue and stays here until updated.
export async function loadToday(user: SessionUser, now: Date): Promise<TodayData> {
  const today = isoDate(now);
  const day = calendarDay(today);
  const pending = { ...followUpAccessWhere(user), status: "PENDING" as const };

  const [overdue, overdueCount, dueToday, comingUp, salesToday] = await Promise.all([
    db.followUp.findMany({
      where: { ...pending, dueDate: { lt: day } },
      select: FOLLOW_UP_ROW,
      orderBy: DAY_ORDER,
      take: OVERDUE_SHOWN,
    }),
    db.followUp.count({ where: { ...pending, dueDate: { lt: day } } }),
    db.followUp.findMany({
      where: { ...pending, dueDate: day },
      select: FOLLOW_UP_ROW,
      orderBy: DAY_ORDER,
    }),
    db.followUp.findMany({
      where: {
        ...pending,
        dueDate: { gt: day, lte: calendarDay(addDays(today, COMING_UP_DAYS)) },
      },
      select: FOLLOW_UP_ROW,
      orderBy: DAY_ORDER,
    }),
    db.sale.count({
      where: { salespersonId: user.id, billDate: day, cancelled: false },
    }),
  ]);

  return {
    today,
    counts: { dueToday: dueToday.length, overdue: overdueCount, salesToday },
    overdue,
    dueToday,
    comingUp,
  };
}
