// The server's own time zone must never decide the greeting or "days late".
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { daysBetween } from "@/lib/follow-up-dates";
import { followUpTiming, LIST_MAX, LIST_PAGE, parseListFilters } from "@/lib/follow-up-list";
import { istHour } from "@/lib/format";
import { greetingKey } from "@/lib/today";

// M11: the pure pieces of the Today screen and the Follow-ups list.

describe("greeting", () => {
  // IST is UTC+5:30, so 06:30 UTC is noon in the shop.
  const at = (utc: string) => greetingKey(istHour(new Date(`2026-09-21T${utc}:00Z`)));

  it("says Good morning until noon IST", () => {
    expect(at("18:30")).toBe("morning"); // 00:00 IST, the day after in UTC terms
    expect(at("06:29")).toBe("morning"); // 11:59 IST
  });

  it("says Good afternoon from 12 to 5 PM IST", () => {
    expect(at("06:30")).toBe("afternoon"); // 12:00 IST
    expect(at("11:29")).toBe("afternoon"); // 16:59 IST
  });

  it("says Good evening from 5 PM IST", () => {
    expect(at("11:30")).toBe("evening"); // 17:00 IST
    expect(at("18:29")).toBe("evening"); // 23:59 IST
  });
});

describe("daysBetween", () => {
  it("counts calendar days, across a month and a year end", () => {
    expect(daysBetween("2026-09-21", "2026-09-24")).toBe(3);
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-02")).toBe(2);
    expect(daysBetween("2026-09-24", "2026-09-21")).toBe(-3);
    expect(daysBetween("2026-09-24", "2026-09-24")).toBe(0);
  });
});

describe("followUpTiming (BR-09)", () => {
  const due = new Date("2026-09-21T00:00:00.000Z"); // a @db.Date value

  it("is late by whole days once the due date has passed", () => {
    expect(followUpTiming(due, "2026-09-22")).toEqual({ kind: "late", days: 1 });
    expect(followUpTiming(due, "2026-09-26")).toEqual({ kind: "late", days: 5 });
  });

  it("is today on the due date and ahead before it", () => {
    expect(followUpTiming(due, "2026-09-21")).toEqual({ kind: "today" });
    expect(followUpTiming(due, "2026-09-20")).toEqual({ kind: "ahead" });
  });
});

describe("parseListFilters", () => {
  it("defaults to the Pending tab and the first page", () => {
    expect(parseListFilters({})).toEqual({ tab: "pending", limit: LIST_PAGE });
  });

  it("reads every filter", () => {
    expect(
      parseListFilters({
        tab: "overdue",
        from: "2026-09-01",
        to: "2026-09-30",
        q: "  Amit ",
        assignedTo: "abc",
        limit: "100",
      }),
    ).toEqual({
      tab: "overdue",
      from: "2026-09-01",
      to: "2026-09-30",
      q: "Amit",
      assignedTo: "abc",
      limit: 100,
    });
  });

  it("falls back to defaults for hand-typed nonsense instead of failing", () => {
    const filters = parseListFilters({ tab: "everything", from: "yesterday", limit: "9999" });
    expect(filters.tab).toBe("pending");
    expect(filters.from).toBeUndefined();
    expect(filters.limit).toBe(LIST_PAGE);
    expect(parseListFilters({ limit: String(LIST_MAX) }).limit).toBe(LIST_MAX);
  });

  it("takes the first of a repeated parameter and ignores empty ones", () => {
    expect(parseListFilters({ tab: ["done", "all"], q: "" })).toEqual({
      tab: "done",
      limit: LIST_PAGE,
    });
  });
});
