import { describe, expect, it } from "vitest";
import { cancelSaleInput, checkBillInput, saleInput, updateSaleInput } from "@/lib/validation/sale";

describe("saleInput (M10.01, M10.04–M10.06)", () => {
  it("trims the bill number and saves it in capitals", () => {
    const parsed = saleInput.parse({ billNumber: "  inv-24567 ", billDate: "2026-09-24" });
    expect(parsed.billNumber).toBe("INV-24567");
  });

  it("refuses an empty or a 31-character bill number", () => {
    expect(saleInput.safeParse({ billNumber: "   ", billDate: "2026-09-24" }).success).toBe(false);
    expect(
      saleInput.safeParse({ billNumber: "X".repeat(31), billDate: "2026-09-24" }).success,
    ).toBe(false);
  });

  it("takes the amount in whole rupees, from a form's text too", () => {
    expect(
      saleInput.parse({ billNumber: "A1", billDate: "2026-09-24", billAmount: "1500" }).billAmount,
    ).toBe(1500);
    expect(
      saleInput.parse({ billNumber: "A1", billDate: "2026-09-24", billAmount: "" }).billAmount,
    ).toBeUndefined();
    expect(
      saleInput.safeParse({ billNumber: "A1", billDate: "2026-09-24", billAmount: "15.50" })
        .success,
    ).toBe(false);
    expect(
      saleInput.safeParse({ billNumber: "A1", billDate: "2026-09-24", billAmount: "-1" }).success,
    ).toBe(false);
  });

  it("keeps remarks to 250 characters", () => {
    expect(
      saleInput.safeParse({ billNumber: "A1", billDate: "2026-09-24", remarks: "x".repeat(251) })
        .success,
    ).toBe(false);
  });
});

describe("checkBillInput", () => {
  it("normalises the number the same way the save does", () => {
    expect(checkBillInput.parse({ billNumber: " inv-1 " }).billNumber).toBe("INV-1");
  });
});

describe("changing a saved sale needs a reason (M10.09)", () => {
  const edit = {
    id: "sale-1",
    billNumber: "INV-1",
    billDate: "2026-09-24",
    salespersonId: "user-1",
  };

  it("refuses an edit or a cancel without one", () => {
    expect(updateSaleInput.safeParse({ ...edit, reason: "  " }).success).toBe(false);
    expect(cancelSaleInput.safeParse({ id: "sale-1", reason: "" }).success).toBe(false);
  });

  it("accepts one", () => {
    expect(updateSaleInput.safeParse({ ...edit, reason: "Wrong amount" }).success).toBe(true);
    expect(cancelSaleInput.safeParse({ id: "sale-1", reason: "Returned" }).success).toBe(true);
  });
});
