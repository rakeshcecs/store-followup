import { describe, expect, it } from "vitest";
import { PREFILL, prefillFestivals } from "@/lib/festivals";
import { dueOccasionJob } from "@/lib/occasions";
import { festivalInput, occasionSettingsInput } from "@/lib/validation/festival";

// M23, the parts with no database: the schemas, the festival pre-fill list and when the
// 6 AM job is due.

describe("festival and occasion schemas", () => {
  it("a festival needs a name, an ISO day and a branch or all", () => {
    expect(
      festivalInput.safeParse({ name: "Diwali", date: "2026-11-08", branch: "all" }).success,
    ).toBe(true);
    expect(
      festivalInput.safeParse({ name: "Diwali", date: "08-11-2026", branch: "all" }).success,
    ).toBe(false);
    expect(festivalInput.safeParse({ name: "", date: "2026-11-08", branch: "b1" }).success).toBe(
      false,
    );
  });

  it("lead days: 1 to 90, from the form's string", () => {
    expect(occasionSettingsInput.parse({ occasionLeadDays: "30" })).toEqual({
      occasionLeadDays: 30,
    });
    expect(occasionSettingsInput.safeParse({ occasionLeadDays: "0" }).success).toBe(false);
    expect(occasionSettingsInput.safeParse({ occasionLeadDays: "91" }).success).toBe(false);
    expect(occasionSettingsInput.safeParse({ occasionLeadDays: "7.5" }).success).toBe(false);
  });
});

describe("festival pre-fill", () => {
  it("this year and next, dated, in order, fixed festivals every year", () => {
    const list = prefillFestivals("2026-09-25");
    expect(list.map((f) => f.date)).toEqual([...list.map((f) => f.date)].sort());
    expect(list.filter((f) => f.key === "diwali").map((f) => f.date)).toEqual([
      "2026-11-08",
      "2027-10-29",
    ]);
    expect(list.filter((f) => f.key === "christmas").map((f) => f.date)).toEqual([
      "2026-12-25",
      "2027-12-25",
    ]);
    expect(list.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date))).toBe(true);
  });

  it("a year the table does not know keeps only the fixed dates", () => {
    const list = prefillFestivals("2031-01-01");
    expect(list.every((f) => PREFILL.find((p) => p.key === f.key)?.fixed)).toBe(true);
    expect(list.length).toBe(PREFILL.filter((p) => p.fixed).length * 2);
  });
});

describe("dueOccasionJob", () => {
  const at = (hhmm: string) => new Date(`2026-09-25T${hhmm}:00.000+05:30`);

  it("is due at 06:00 IST and on every later hour, with one key for the day", () => {
    expect(dueOccasionJob(at("05:59"))).toBeNull();
    expect(dueOccasionJob(at("06:00"))).toEqual({
      type: "occasion-follow-ups",
      payload: { date: "2026-09-25" },
      singletonKey: "occasion-follow-ups:2026-09-25",
    });
    expect(dueOccasionJob(at("06:30"))).toBeNull();
    expect(dueOccasionJob(at("11:00"))?.singletonKey).toBe("occasion-follow-ups:2026-09-25");
    expect(dueOccasionJob(at("00:00"))).toBeNull();
  });
});
