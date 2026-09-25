import { describe, expect, it } from "vitest";
import { dateWhere, instantWhere, parsePeriod } from "@/lib/dashboard-period";

// M12.01: which days each period covers. 16 Sep 2026 is a Wednesday.
const WED = "2026-09-16";

describe("parsePeriod", () => {
  const range = (params: Record<string, string | undefined>, today = WED) =>
    parsePeriod(params, today);

  it("defaults to today", () => {
    expect(range({})).toEqual({ period: "today", range: { from: WED, to: WED } });
  });

  it("yesterday is one day, across a month end too", () => {
    expect(range({ period: "yesterday" }).range).toEqual({ from: "2026-09-15", to: "2026-09-15" });
    expect(range({ period: "yesterday" }, "2026-10-01").range).toEqual({
      from: "2026-09-30",
      to: "2026-09-30",
    });
  });

  it("this week runs from Monday to today", () => {
    expect(range({ period: "week" }).range).toEqual({ from: "2026-09-14", to: WED });
    // On a Monday it is just that day; on a Sunday, the six days before as well.
    expect(range({ period: "week" }, "2026-09-14").range.from).toBe("2026-09-14");
    expect(range({ period: "week" }, "2026-09-20").range.from).toBe("2026-09-14");
  });

  it("this month runs from the 1st to today", () => {
    expect(range({ period: "month" }).range).toEqual({ from: "2026-09-01", to: WED });
  });

  it("takes a custom range as given", () => {
    expect(range({ period: "custom", from: "2026-01-01", to: "2026-03-31" })).toEqual({
      period: "custom",
      range: { from: "2026-01-01", to: "2026-03-31" },
    });
  });

  it("falls back to today for anything unusable", () => {
    for (const params of [
      { period: "fortnight" },
      { period: "custom", from: "2026-09-10" }, // half a range
      { period: "custom", from: "2026-09-10", to: "2026-09-01" }, // backwards
      { period: "custom", from: "2025-01-01", to: "2026-09-10" }, // over a year
      { period: "custom", from: "10/09/2026", to: "2026-09-12" },
    ]) {
      expect(range(params).period, JSON.stringify(params)).toBe("today");
    }
  });
});

describe("the period in the database's terms", () => {
  it("calendar columns compare as UTC midnights, inclusive", () => {
    expect(dateWhere({ from: "2026-09-14", to: WED })).toEqual({
      gte: new Date("2026-09-14T00:00:00.000Z"),
      lte: new Date("2026-09-16T00:00:00.000Z"),
    });
  });

  it("instants run from IST midnight to the next IST midnight", () => {
    const { gte, lt } = instantWhere({ from: WED, to: WED });
    expect(gte.toISOString()).toBe("2026-09-15T18:30:00.000Z");
    expect(lt.toISOString()).toBe("2026-09-16T18:30:00.000Z");
  });
});
