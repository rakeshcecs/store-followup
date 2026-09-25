import { describe, expect, it } from "vitest";
import { isRealDay } from "@/lib/validation/common";
import { createCustomerInput } from "@/lib/validation/customer";
import { billDateField } from "@/lib/validation/sale";
import { staffInput } from "@/lib/validation/staff";
import { followUpInput } from "@/lib/validation/visit";

// Every date a form or a URL sends: the shape alone let "2026-02-30" through (saved as
// 2 March) and "2026-13-01" (an Invalid Date that crashed the save or the screen).
const BAD = [
  "2026-02-30",
  "2026-13-01",
  "2026-00-10",
  "2026-04-31",
  "2027-02-29",
  "2026-9-1",
  "26-09-01",
  "",
  "tomorrow",
];
const GOOD = ["2026-09-25", "2028-02-29", "2026-12-31", "2027-01-01"];

describe("isRealDay", () => {
  it.each(GOOD)("accepts %s", (day) => expect(isRealDay(day)).toBe(true));
  it.each(BAD)("refuses %s", (day) => expect(isRealDay(day)).toBe(false));
});

describe("each date field refuses a day that does not exist, with its own message", () => {
  it("customer occasion date", () => {
    const base = { name: "Asha Patel", mobile: "9876543210", assignedToId: "user-1" };
    const result = createCustomerInput.safeParse({ ...base, occasionDate: "2026-02-30" });
    expect(result.error?.issues[0]?.message).toBe("customers.errors.occasionDateInvalid");
    expect(createCustomerInput.safeParse({ ...base, occasionDate: "" }).success).toBe(true);
  });

  it("bill date", () => {
    expect(billDateField.safeParse("2026-13-01").error?.issues[0]?.message).toBe(
      "visits.errors.billDateInvalid",
    );
  });

  it("follow-up due date", () => {
    const result = followUpInput.safeParse({
      dueDate: "2026-04-31",
      timeSlot: "EVENING",
      method: "CALL",
    });
    expect(result.error?.issues[0]?.message).toBe("visits.errors.dueDateInvalid");
  });

  it("staff joined on", () => {
    const result = staffInput.safeParse({
      fullName: "Ravi Shah",
      mobile: "9876543210",
      role: "SALESPERSON",
      homeBranchId: "b1",
      joinedOn: "2027-02-29",
      extraBranchIds: "",
    });
    expect(result.error?.issues[0]?.message).toBe("staff.errors.joinedOnInvalid");
  });
});
