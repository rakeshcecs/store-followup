import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordVisitInput } from "@/lib/validation/visit";
import { enquiryTitle, visitTypeFor } from "@/lib/visits";

const base = () => ({
  clientId: randomUUID(),
  customerId: "cust-1",
  categoryIds: ["cat-1"],
});

describe("recordVisitInput (BR-03, BR-04, BR-05)", () => {
  it("refuses a bought visit without its sale", () => {
    expect(recordVisitInput.safeParse({ ...base(), outcome: "PURCHASED" }).success).toBe(false);
  });

  it("refuses a decide-later visit without its follow-up", () => {
    expect(recordVisitInput.safeParse({ ...base(), outcome: "DECIDE_LATER" }).success).toBe(false);
  });

  it("refuses not interested without a reason", () => {
    const parsed = recordVisitInput.safeParse({ ...base(), outcome: "NOT_INTERESTED" });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues[0]?.message).toBe("visits.errors.reasonRequired");
  });

  it("refuses a visit with no category", () => {
    const parsed = recordVisitInput.safeParse({
      ...base(),
      categoryIds: [],
      outcome: "NOT_INTERESTED",
      lostReasonId: "r-1",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("visits.errors.categoryRequired");
    }
  });

  it("refuses remarks over 500 characters", () => {
    const parsed = recordVisitInput.safeParse({
      ...base(),
      remarks: "x".repeat(501),
      outcome: "NOT_INTERESTED",
      lostReasonId: "r-1",
    });
    expect(parsed.success).toBe(false);
  });

  it("trims the bill number and saves it in capitals, up to 30 characters", () => {
    const parsed = recordVisitInput.safeParse({
      ...base(),
      outcome: "PURCHASED",
      sale: { billNumber: "  inv-204a ", billDate: "2026-09-24" },
    });
    expect(
      parsed.success && parsed.data.outcome === "PURCHASED" && parsed.data.sale.billNumber,
    ).toBe("INV-204A");
    const long = recordVisitInput.safeParse({
      ...base(),
      outcome: "PURCHASED",
      sale: { billNumber: "X".repeat(31), billDate: "2026-09-24" },
    });
    expect(long.success).toBe(false);
  });

  it("accepts a complete decide-later visit", () => {
    const parsed = recordVisitInput.safeParse({
      ...base(),
      outcome: "DECIDE_LATER",
      followUp: { dueDate: "2026-09-26", timeSlot: "EVENING", method: "CALL" },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("visitTypeFor (BR-13)", () => {
  // 10:00 IST on 24 Sep 2026.
  const now = new Date("2026-09-24T04:30:00.000Z");

  it("is New on the first visit and on any other visit that same day", () => {
    expect(visitTypeFor(null, now)).toBe("NEW");
    // 00:30 IST the same day — still 23 Sep in UTC.
    expect(visitTypeFor(new Date("2026-09-23T19:00:00.000Z"), now)).toBe("NEW");
  });

  it("is Existing from the next day, counted in IST", () => {
    // 23:30 IST on 23 Sep.
    expect(visitTypeFor(new Date("2026-09-23T18:00:00.000Z"), now)).toBe("EXISTING");
  });
});

describe("enquiryTitle (SOW 5.4)", () => {
  it("is made from the first two categories", () => {
    expect(enquiryTitle(["Sherwani", "Wedding Clothes", "Suit"])).toBe("Sherwani, Wedding Clothes");
    expect(enquiryTitle(["Saree"])).toBe("Saree");
  });
});
