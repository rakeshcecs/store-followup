import { describe, expect, it } from "vitest";
import { dayForDisplay, followUpShortcut } from "@/lib/follow-up-dates";
import { formatDayDate, isoDate } from "@/lib/format";

// M08 "Done when": the date shortcuts are right for every day of the week, in IST.
// 21 Sep 2026 is a Monday — the prototype's own week (Tomorrow = Tue 22, This Saturday =
// Sat 26, Next week = Mon 28, After 10 days = Thu 1 Oct).
const WEEK = [
  // today, tomorrow, this Saturday, next week (Monday), after 10 days
  ["2026-09-21", "2026-09-22", "2026-09-26", "2026-09-28", "2026-10-01"], // Mon
  ["2026-09-22", "2026-09-23", "2026-09-26", "2026-09-28", "2026-10-02"], // Tue
  ["2026-09-23", "2026-09-24", "2026-09-26", "2026-09-28", "2026-10-03"], // Wed
  ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", "2026-10-04"], // Thu
  ["2026-09-25", "2026-09-26", "2026-09-26", "2026-09-28", "2026-10-05"], // Fri
  ["2026-09-26", "2026-09-27", "2026-09-26", "2026-09-28", "2026-10-06"], // Sat: same day
  ["2026-09-27", "2026-09-28", "2026-10-03", "2026-09-28", "2026-10-07"], // Sun: coming Sat
] as const;

describe("follow-up date shortcuts (M08.01)", () => {
  it.each(WEEK)("from %s", (today, tomorrow, saturday, nextWeek, tenDays) => {
    expect(followUpShortcut("TOMORROW", today)).toBe(tomorrow);
    expect(followUpShortcut("SATURDAY", today)).toBe(saturday);
    expect(followUpShortcut("NEXT_WEEK", today)).toBe(nextWeek);
    expect(followUpShortcut("TEN_DAYS", today)).toBe(tenDays);
  });

  it("crosses a month and a year end", () => {
    const today = "2026-12-31"; // Thursday
    expect(followUpShortcut("TOMORROW", today)).toBe("2027-01-01");
    expect(followUpShortcut("SATURDAY", today)).toBe("2027-01-02");
    expect(followUpShortcut("NEXT_WEEK", today)).toBe("2027-01-04");
    expect(followUpShortcut("TEN_DAYS", today)).toBe("2027-01-10");
  });

  it("counts from the day in India, not in UTC", () => {
    // 00:15 on Saturday in India is still Friday in UTC.
    const saturdayJustAfterMidnight = isoDate(new Date("2026-09-25T18:45:00.000Z"));
    expect(followUpShortcut("SATURDAY", saturdayJustAfterMidnight)).toBe("2026-09-26");
    // 23:30 on Saturday in India.
    const saturdayLateNight = isoDate(new Date("2026-09-26T18:00:00.000Z"));
    expect(followUpShortcut("SATURDAY", saturdayLateNight)).toBe("2026-09-26");
    expect(followUpShortcut("TOMORROW", saturdayLateNight)).toBe("2026-09-27");
  });

  it("shows the chosen day in words", () => {
    expect(formatDayDate(dayForDisplay("2026-09-26"), "en")).toBe("Sat, 26 Sep");
  });
});
