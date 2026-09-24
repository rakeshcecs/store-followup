import { describe, expect, it } from "vitest";
import { createCustomerInput } from "@/lib/validation/customer";

const valid = { name: "Asha Patel", mobile: "9876543210", assignedToId: "user-1" };

const firstIssue = (result: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues[0];

describe("createCustomerInput", () => {
  it("needs only a name, a mobile number and who handles them", () => {
    const parsed = createCustomerInput.parse({ ...valid });
    expect(parsed.name).toBe("Asha Patel");
    expect(parsed.departmentId).toBeUndefined();
    expect(parsed.area).toBeUndefined();
  });

  it("says the same thing about a bad number as the search screen does", () => {
    // M05.03 spells this message out, and the two screens must not disagree.
    const result = createCustomerInput.safeParse({ ...valid, mobile: "12345" });
    expect(firstIssue(result)?.message).toBe("customers.errors.mobileInvalid");
  });

  it.each([
    ["+91 98765 43210", "9876543210"],
    ["98765-43210", "9876543210"],
    ["098765 43210", "9876543210"],
  ])("accepts %s however it is typed and stores %s", (typed, stored) => {
    expect(createCustomerInput.parse({ ...valid, mobile: typed }).mobile).toBe(stored);
  });

  it("refuses an empty name", () => {
    const result = createCustomerInput.safeParse({ ...valid, name: "   " });
    expect(firstIssue(result)?.message).toBe("customers.errors.nameRequired");
    expect(firstIssue(result)?.path).toEqual(["name"]);
  });

  it("treats an untouched optional box as not given, not as empty", () => {
    const parsed = createCustomerInput.parse({ ...valid, area: "", city: "", altMobile: "" });
    expect(parsed.area).toBeUndefined();
    expect(parsed.city).toBeUndefined();
    expect(parsed.altMobile).toBeUndefined();
  });

  it("still checks an alternate number that was given", () => {
    // It is searched too, so a half-typed one would simply never be found.
    expect(createCustomerInput.safeParse({ ...valid, altMobile: "12345" }).success).toBe(false);
    expect(createCustomerInput.parse({ ...valid, altMobile: "+91 98250 11223" }).altMobile).toBe(
      "9825011223",
    );
  });

  it("reads the consent checkbox, including the unticked case", () => {
    // A form sends "on" for a ticked box and nothing at all for an unticked one.
    expect(createCustomerInput.parse({ ...valid, consentGiven: "on" }).consentGiven).toBe(true);
    expect(createCustomerInput.parse({ ...valid }).consentGiven).toBe(false);
  });

  it("takes a calendar date, not a timestamp", () => {
    expect(createCustomerInput.parse({ ...valid, occasionDate: "2026-11-21" }).occasionDate).toBe(
      "2026-11-21",
    );
    const result = createCustomerInput.safeParse({ ...valid, occasionDate: "21/11/2026" });
    expect(firstIssue(result)?.message).toBe("customers.errors.occasionDateInvalid");
  });

  it("refuses a name longer than the column", () => {
    const result = createCustomerInput.safeParse({ ...valid, name: "x".repeat(101) });
    expect(firstIssue(result)?.message).toBe("customers.errors.nameTooLong");
  });
});

// SOW 5.3: Area and City Text (60), Address Text (250). Found in the cross-role audit,
// where a 61-character area was saved.
describe("customer detail lengths (SOW 5.3)", () => {
  it.each([
    ["area", 60, "customers.errors.areaTooLong"],
    ["city", 60, "customers.errors.cityTooLong"],
    ["address", 250, "customers.errors.addressTooLong"],
  ] as const)("%s takes %i characters and no more", (field, max, message) => {
    expect(createCustomerInput.safeParse({ ...valid, [field]: "a".repeat(max) }).success).toBe(
      true,
    );
    const over = createCustomerInput.safeParse({ ...valid, [field]: "a".repeat(max + 1) });
    expect(firstIssue(over)?.message).toBe(message);
  });
});
