import { describe, expect, it } from "vitest";
import { generateTempPin } from "@/lib/temp-pin";
import { pinField } from "@/lib/validation/auth";

describe("generateTempPin", () => {
  // Enough runs to see the blocked values if they could come out at all: there are only
  // 10,000 PINs, and 12 of them are refused.
  const pins = Array.from({ length: 2000 }, () => generateTempPin());

  it("always returns four digits", () => {
    for (const pin of pins) expect(pin).toMatch(/^\d{4}$/);
  });

  it("never hands out a PIN a person would not be allowed to choose", () => {
    for (const pin of pins) expect(pinField.safeParse(pin).success).toBe(true);
  });

  it("is not the same PIN every time", () => {
    expect(new Set(pins).size).toBeGreaterThan(100);
  });
});
