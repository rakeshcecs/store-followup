import { describe, expect, it } from "vitest";
import { branchInput, setCurrentBranchInput } from "@/lib/validation/branch";

const valid = {
  name: "Main Branch",
  address: "12 MG Road",
  city: "Ahmedabad",
  phone: "079 1234 5678",
  gstNumber: "",
  openingHours: "",
};

function messages(input: Record<string, unknown>): string[] {
  const parsed = branchInput.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("branchInput", () => {
  it("accepts a branch with only the required fields filled in", () => {
    const parsed = branchInput.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ name: "Main Branch", city: "Ahmedabad" });
    expect(parsed.data?.gstNumber).toBeUndefined();
    expect(parsed.data?.openingHours).toBeUndefined();
  });

  it("trims what is typed", () => {
    expect(branchInput.safeParse({ ...valid, name: "  Main Branch  " }).data?.name).toBe(
      "Main Branch",
    );
  });

  it("reports every empty required field at once", () => {
    expect(messages({ ...valid, name: "", address: "", city: "", phone: "" })).toEqual([
      "branches.errors.nameRequired",
      "branches.errors.addressRequired",
      "branches.errors.cityRequired",
      "branches.errors.phoneInvalid",
    ]);
  });

  it("limits the length of each text field", () => {
    // SOW 5.8: the branch name is Text(80).
    expect(branchInput.safeParse({ ...valid, name: "x".repeat(80) }).success).toBe(true);
    expect(messages({ ...valid, name: "x".repeat(81) })).toContain("branches.errors.nameTooLong");
    expect(messages({ ...valid, address: "x".repeat(256) })).toContain(
      "branches.errors.addressTooLong",
    );
    expect(messages({ ...valid, city: "x".repeat(101) })).toContain("branches.errors.cityTooLong");
    expect(messages({ ...valid, openingHours: "x".repeat(101) })).toContain(
      "branches.errors.openingHoursTooLong",
    );
  });

  it("rejects a phone number with letters", () => {
    expect(messages({ ...valid, phone: "call us" })).toContain("branches.errors.phoneInvalid");
  });

  it("accepts a GST number in lower case and stores it upper case", () => {
    const parsed = branchInput.safeParse({ ...valid, gstNumber: "24aaapl1234c1zv" });
    expect(parsed.data?.gstNumber).toBe("24AAAPL1234C1ZV");
  });

  it("rejects a GST number of the wrong shape", () => {
    expect(messages({ ...valid, gstNumber: "24AAAPL1234C1Z" })).toContain(
      "branches.errors.gstInvalid",
    );
  });
});

describe("setCurrentBranchInput", () => {
  it("accepts a branch id and the all-branches choice", () => {
    expect(setCurrentBranchInput.safeParse({ branchId: "abc123" }).success).toBe(true);
    expect(setCurrentBranchInput.safeParse({ branchId: "all" }).success).toBe(true);
  });

  it("rejects an empty choice", () => {
    expect(setCurrentBranchInput.safeParse({ branchId: "" }).success).toBe(false);
  });
});
