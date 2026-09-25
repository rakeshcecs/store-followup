import { describe, expect, it } from "vitest";
import { audienceWhere } from "@/lib/campaigns/audience";
import { readCounts } from "@/lib/campaigns/send";
import { PREFILL, prefillFestivals } from "@/lib/festivals";
import { dueOccasionJob } from "@/lib/occasions";
import {
  campaignFilters,
  campaignVariables,
  createCampaignInput,
  festivalInput,
  occasionSettingsInput,
} from "@/lib/validation/campaign";
import { fillCampaignTemplate } from "@/lib/whatsapp/templates";

// M23, the parts with no database: the schemas, the campaign's own template filling, the
// festival pre-fill list and when the 6 AM job is due.

describe("campaign schemas", () => {
  it("filters: everything optional, empty strings mean not set", () => {
    const parsed = campaignFilters.parse({
      categoryIds: [],
      departmentId: "",
      lastVisitFrom: "",
      lastVisitTo: "",
      boughtFrom: "",
      boughtTo: "",
      lostReasonId: "",
      occasionWithinDays: "",
    });
    expect(parsed).toEqual({ categoryIds: [] });
    expect(campaignFilters.parse({ occasionWithinDays: "30" }).occasionWithinDays).toBe(30);
  });

  it("filters: a range that ends before it starts is refused, with the field named", () => {
    const result = campaignFilters.safeParse({
      lastVisitFrom: "2026-10-05",
      lastVisitTo: "2026-10-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        message: "campaigns.errors.dateOrder",
        path: ["lastVisitTo"],
      });
    }
    expect(campaignFilters.safeParse({ occasionWithinDays: "0" }).success).toBe(false);
    expect(campaignFilters.safeParse({ intent: "LUKEWARM" }).success).toBe(false);
  });

  it("variables: a fixed text or one of the campaign fields, never a visit date", () => {
    expect(
      campaignVariables.parse({
        "1": { kind: "field", field: "customerFirstName" },
        "2": { kind: "text", text: "20% off" },
      }),
    ).toEqual({
      "1": { kind: "field", field: "customerFirstName" },
      "2": { kind: "text", text: "20% off" },
    });
    expect(
      campaignVariables.safeParse({ "1": { kind: "field", field: "visitDate" } }).success,
    ).toBe(false);
    expect(campaignVariables.safeParse({ "1": { kind: "text", text: "  " } }).success).toBe(false);
  });

  it("create: name and schedule", () => {
    const base = { branch: "all", templateId: "t1", variables: {}, filters: {} };
    expect(createCampaignInput.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(
      createCampaignInput.parse({ ...base, name: "Diwali", scheduledAt: "" }).scheduledAt,
    ).toBeUndefined();
    expect(
      createCampaignInput.parse({
        ...base,
        name: "Diwali",
        scheduledAt: "2026-11-01T05:00:00.000Z",
      }).scheduledAt,
    ).toBe("2026-11-01T05:00:00.000Z");
    expect(
      createCampaignInput.safeParse({ ...base, name: "Diwali", scheduledAt: "tomorrow" }).success,
    ).toBe(false);
  });

  it("festival and occasion settings", () => {
    expect(
      festivalInput.safeParse({ name: "Diwali", date: "2026-11-08", branch: "all" }).success,
    ).toBe(true);
    expect(
      festivalInput.safeParse({ name: "Diwali", date: "08-11-2026", branch: "all" }).success,
    ).toBe(false);
    expect(
      occasionSettingsInput.parse({ occasionLeadDays: "30", campaignWeeklyLimit: "2" }),
    ).toEqual({
      occasionLeadDays: 30,
      campaignWeeklyLimit: 2,
    });
    expect(
      occasionSettingsInput.safeParse({ occasionLeadDays: "0", campaignWeeklyLimit: "2" }).success,
    ).toBe(false);
    expect(
      occasionSettingsInput.safeParse({ occasionLeadDays: "30", campaignWeeklyLimit: "8" }).success,
    ).toBe(false);
  });
});

describe("fillCampaignTemplate", () => {
  const template = { variables: ["1", "2"] };
  const values = { customerFirstName: "Asha", occasion: null };

  it("fixed text and customer fields, in placeholder order", () => {
    expect(
      fillCampaignTemplate(
        template,
        {
          "1": { kind: "field", field: "customerFirstName" },
          "2": { kind: "text", text: "20% off" },
        },
        values,
      ),
    ).toEqual({ ok: true, parameters: ["Asha", "20% off"] });
  });

  it("names the field the customer lacks, or an unfilled placeholder", () => {
    expect(
      fillCampaignTemplate(
        template,
        { "1": { kind: "field", field: "occasion" }, "2": { kind: "text", text: "x" } },
        values,
      ),
    ).toEqual({ ok: false, missing: "occasion" });
    expect(fillCampaignTemplate(template, { "1": { kind: "text", text: "x" } }, values)).toEqual({
      ok: false,
      missing: "unmapped",
    });
  });
});

describe("audienceWhere", () => {
  it("always leaves out inactive, deleted and number-less customers", () => {
    const where = audienceWhere(
      { branchId: null, filters: campaignFilters.parse({}) },
      "2026-09-25",
    );
    expect(where.AND).toEqual([{ active: true, anonymizedAt: null, mobile: { not: null } }]);
  });

  it("a branch campaign takes the customers the branch handles", () => {
    const where = audienceWhere(
      { branchId: "b1", filters: campaignFilters.parse({}) },
      "2026-09-25",
    );
    expect(where.AND).toContainEqual({
      OR: [{ homeBranchId: "b1" }, { visits: { some: { branchId: "b1" } } }],
    });
  });

  it("occasion in the next N days is a date range from today", () => {
    const where = audienceWhere(
      { branchId: null, filters: campaignFilters.parse({ occasionWithinDays: 10 }) },
      "2026-09-25",
    );
    expect(where.AND).toContainEqual({
      occasionDate: {
        gte: new Date("2026-09-25T00:00:00.000Z"),
        lte: new Date("2026-10-05T00:00:00.000Z"),
      },
    });
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

describe("readCounts", () => {
  it("reads what the worker stored and nothing else", () => {
    expect(readCounts(null)).toBeNull();
    expect(readCounts({ matched: 5, queued: 3, extra: "x" })).toEqual({
      matched: 5,
      noConsent: 0,
      weeklyLimit: 0,
      missingField: 0,
      ready: 0,
      queued: 3,
    });
  });
});
