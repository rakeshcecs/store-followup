import { describe, expect, it } from "vitest";
import { getInitials } from "@/lib/initials";

describe("getInitials", () => {
  it.each([
    ["Ramesh Kumar Patel", "RP"],
    ["sita", "S"],
    ["  Asha   Rao  ", "AR"],
    ["", ""],
    ["सीता देवी", "सद"],
  ])("%s -> %s", (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });
});
