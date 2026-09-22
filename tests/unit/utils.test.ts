import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins classes and drops falsy values", () => {
    expect(cn("p-4", false, undefined, "text-sm")).toBe("p-4 text-sm");
  });

  it("lets the last conflicting Tailwind class win", () => {
    expect(cn("p-2 bg-primary", "p-4")).toBe("bg-primary p-4");
  });
});
