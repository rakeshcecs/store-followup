import { describe, expect, it } from "vitest";
import { customerStatus, isOverdue } from "@/lib/customer-status";
import { TIMELINE, timelineTone } from "@/lib/timeline";
import { createCustomerInput, updateCustomerInput } from "@/lib/validation/customer";

// 10:00 IST on 24 Sep 2026.
const now = new Date("2026-09-24T04:30:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`); // how a @db.Date reads back

describe("customerStatus (SOW 6.1)", () => {
  it("is New customer before any enquiry exists", () => {
    expect(customerStatus({ latestEnquiry: null, pendingFollowUpDue: null, now })).toBe("new");
  });

  it("is Visited with an open enquiry and nothing pending", () => {
    expect(customerStatus({ latestEnquiry: "OPEN", pendingFollowUpDue: null, now })).toBe(
      "visited",
    );
  });

  it("is Follow-up pending when the follow-up is today or later", () => {
    for (const due of ["2026-09-24", "2026-09-30"]) {
      expect(customerStatus({ latestEnquiry: "OPEN", pendingFollowUpDue: day(due), now })).toBe(
        "followUpPending",
      );
    }
  });

  it("is Follow-up overdue when the follow-up was due before today (BR-09)", () => {
    expect(
      customerStatus({ latestEnquiry: "OPEN", pendingFollowUpDue: day("2026-09-23"), now }),
    ).toBe("followUpOverdue");
  });

  it("is Sale completed or Not interested from the latest enquiry, whatever else is pending", () => {
    const overdue = day("2026-09-01");
    expect(
      customerStatus({ latestEnquiry: "SALE_COMPLETED", pendingFollowUpDue: overdue, now }),
    ).toBe("saleCompleted");
    expect(
      customerStatus({ latestEnquiry: "NOT_INTERESTED", pendingFollowUpDue: overdue, now }),
    ).toBe("notInterested");
  });
});

describe("isOverdue", () => {
  it("cuts the day in IST, not UTC", () => {
    // 00:30 IST on 25 Sep is still 24 Sep in UTC; a follow-up due on the 24th is now
    // overdue in the shop even though UTC has not moved on yet.
    const justAfterMidnightIst = new Date("2026-09-24T19:00:00.000Z");
    expect(isOverdue(day("2026-09-24"), justAfterMidnightIst)).toBe(true);
    // 23:59 IST on 24 Sep: not yet.
    expect(isOverdue(day("2026-09-24"), new Date("2026-09-24T18:29:00.000Z"))).toBe(false);
  });
});

describe("timelineTone (M06)", () => {
  it("colours follow-ups amber, a sale green, not interested grey, the rest indigo", () => {
    expect(timelineTone(TIMELINE.followUpSet.type)).toBe("amber");
    expect(timelineTone(TIMELINE.followUpResult.type)).toBe("amber");
    expect(timelineTone(TIMELINE.saleCompleted.type)).toBe("green");
    expect(timelineTone(TIMELINE.notInterested.type)).toBe("grey");
    for (const kind of ["customerAdded", "detailsEdited", "visit", "reassigned"] as const) {
      expect(timelineTone(TIMELINE[kind].type)).toBe("indigo");
    }
    // A cancelled sale is no longer a sale.
    expect(timelineTone(TIMELINE.saleCancelled.type)).toBe("indigo");
  });

  it("stores every type within the 40-character column", () => {
    for (const { type } of Object.values(TIMELINE)) expect(type.length).toBeLessThanOrEqual(40);
  });
});

describe("updateCustomerInput", () => {
  const base = { id: "cust-1", name: "Asha Patel" };

  it("accepts a form with no mobile box (a salesperson's)", () => {
    const parsed = updateCustomerInput.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.mobile).toBeUndefined();
  });

  it("normalises a typed mobile and refuses a bad one", () => {
    const good = updateCustomerInput.safeParse({ ...base, mobile: "+91 98765 43210" });
    expect(good.success && good.data.mobile).toBe("9876543210");
    const bad = updateCustomerInput.safeParse({ ...base, mobile: "12345" });
    expect(bad.success).toBe(false);
  });

  it("refuses an alternate number that repeats the main number (BR-01)", () => {
    const same = updateCustomerInput.safeParse({
      ...base,
      mobile: "9876543210",
      altMobile: "98765 43210",
    });
    expect(same.success).toBe(false);
    if (!same.success) {
      expect(same.error.issues[0]?.path).toEqual(["altMobile"]);
      expect(same.error.issues[0]?.message).toBe("customers.errors.altSameAsMobile");
    }
    const create = createCustomerInput.safeParse({
      ...base,
      mobile: "9876543210",
      altMobile: "9876543210",
      assignedToId: "user-1",
    });
    expect(create.success).toBe(false);
    // Different numbers pass.
    expect(
      updateCustomerInput.safeParse({ ...base, mobile: "9876543210", altMobile: "9825011223" })
        .success,
    ).toBe(true);
  });

  it("reads an emptied box as not given, which the action stores as cleared", () => {
    const parsed = updateCustomerInput.safeParse({ ...base, area: "  ", altMobile: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.area).toBeUndefined();
      expect(parsed.data.altMobile).toBeUndefined();
    }
  });
});
