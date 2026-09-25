// The festival calendar (M23). Common Indian festivals are pre-filled for this year and
// next from the table below; the admin confirms each date (lunar festivals move, and
// the printed almanacs differ by a day now and then), edits it, or removes it.
//
// audit-exempt: the actions in src/lib/actions/festival.ts write every festival row and
// its audit entry; this file only reads and offers the pre-fill list.
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { calendarDay } from "@/lib/follow-ups";

// Fixed-date festivals repeat every year; the moving ones are listed for the years we
// know. `key` is the message key under festivals.names.
type Prefill = { key: string; fixed?: string; dates?: Record<string, string> };

export const PREFILL: Prefill[] = [
  { key: "newYear", fixed: "01-01" },
  { key: "uttarayan", dates: { "2026": "01-14", "2027": "01-15" } },
  { key: "republicDay", fixed: "01-26" },
  { key: "mahaShivratri", dates: { "2026": "02-15", "2027": "03-06" } },
  { key: "holi", dates: { "2026": "03-04", "2027": "03-22" } },
  { key: "eidUlFitr", dates: { "2026": "03-21", "2027": "03-10" } },
  { key: "gudiPadwa", dates: { "2026": "03-19", "2027": "04-07" } },
  { key: "ramNavami", dates: { "2026": "03-26", "2027": "04-15" } },
  { key: "akshayaTritiya", dates: { "2026": "04-19", "2027": "05-08" } },
  { key: "eidUlAdha", dates: { "2026": "05-27", "2027": "05-17" } },
  { key: "independenceDay", fixed: "08-15" },
  { key: "rakshaBandhan", dates: { "2026": "08-28", "2027": "08-17" } },
  { key: "janmashtami", dates: { "2026": "09-04", "2027": "08-25" } },
  { key: "ganeshChaturthi", dates: { "2026": "09-14", "2027": "09-04" } },
  { key: "onam", dates: { "2026": "08-26", "2027": "08-15" } },
  { key: "navratri", dates: { "2026": "10-11", "2027": "09-30" } },
  { key: "dussehra", dates: { "2026": "10-20", "2027": "10-09" } },
  { key: "karvaChauth", dates: { "2026": "10-29", "2027": "10-18" } },
  { key: "dhanteras", dates: { "2026": "11-06", "2027": "10-26" } },
  { key: "diwali", dates: { "2026": "11-08", "2027": "10-29" } },
  { key: "bhaiDooj", dates: { "2026": "11-10", "2027": "10-31" } },
  { key: "chhathPuja", dates: { "2026": "11-15", "2027": "11-04" } },
  { key: "guruNanakJayanti", dates: { "2026": "11-24", "2027": "11-14" } },
  { key: "christmas", fixed: "12-25" },
];

export type PrefillFestival = { key: string; date: string }; // date "YYYY-MM-DD"

// This year's and next year's dates we know, in date order.
export function prefillFestivals(today: string): PrefillFestival[] {
  const year = Number(today.slice(0, 4));
  const out: PrefillFestival[] = [];
  for (const y of [year, year + 1]) {
    for (const festival of PREFILL) {
      const monthDay = festival.fixed ?? festival.dates?.[String(y)];
      if (monthDay) out.push({ key: festival.key, date: `${y}-${monthDay}` });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type FestivalRow = {
  id: string;
  name: string;
  date: Date;
  branchId: string | null;
  branchName: string | null;
  confirmed: boolean;
};

const select = {
  id: true,
  name: true,
  date: true,
  branchId: true,
  confirmed: true,
  branch: { select: { name: true } },
} as const;

type Row = Prisma.FestivalGetPayload<{ select: typeof select }>;
const toRow = (row: Row): FestivalRow => ({
  id: row.id,
  name: row.name,
  date: row.date,
  branchId: row.branchId,
  branchName: row.branch?.name ?? null,
  confirmed: row.confirmed,
});

// The admin's calendar: from the start of this year on, oldest first.
export async function listFestivals(today: string): Promise<FestivalRow[]> {
  const rows = await db.festival.findMany({
    where: { active: true, date: { gte: calendarDay(`${today.slice(0, 4)}-01-01`) } },
    orderBy: [{ date: "asc" }, { name: "asc" }],
    select,
  });
  return rows.map(toRow);
}
