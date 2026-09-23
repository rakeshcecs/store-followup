import { describe, expect, it } from "vitest";
import { normalizeMobile } from "@/lib/mobile";

describe("normalizeMobile", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["98765 43210", "9876543210"], // as the app displays it
    ["+91 98765 43210", "9876543210"],
    ["919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["98765-43210", "9876543210"],
    [" 6012345678 ", "6012345678"],
  ])("reads %s as %s", (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it.each([
    ["5876543210", "starts with 5, which is not an Indian mobile"],
    ["987654321", "nine digits"],
    ["98765432101", "eleven digits"],
    ["022 2345 6789", "a landline whose code cannot be read as a mobile"],
    ["", "empty"],
    ["not a number", "no digits at all"],
  ])("refuses %s (%s)", (input) => {
    expect(normalizeMobile(input)).toBeNull();
  });

  it("cannot tell one landline shape apart, and is honest about it", () => {
    // 079 1234 5678 is a landline, but its digits are indistinguishable from a mobile
    // written with a leading 0. Documented in src/lib/mobile.ts.
    expect(normalizeMobile("079 1234 5678")).toBe("7912345678");
  });

  it("refuses anything that is not a string", () => {
    expect(normalizeMobile(9876543210)).toBeNull();
    expect(normalizeMobile(null)).toBeNull();
    expect(normalizeMobile(undefined)).toBeNull();
  });
});
