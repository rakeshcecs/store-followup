import { describe, expect, it } from "vitest";
import { reorderedIds } from "@/lib/reorder";

describe("reorderedIds", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a row down", () => {
    expect(reorderedIds(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a row up", () => {
    expect(reorderedIds(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("keeps every id exactly once, which is what the server renumbers 1..n", () => {
    const moved = reorderedIds(ids, "c", "a");
    expect([...moved].sort()).toEqual([...ids].sort());
    expect(new Set(moved).size).toBe(ids.length);
  });

  it("changes nothing when the row is dropped on itself or on something unknown", () => {
    expect(reorderedIds(ids, "b", "b")).toEqual(ids);
    expect(reorderedIds(ids, "b", "zz")).toEqual(ids);
  });
});
