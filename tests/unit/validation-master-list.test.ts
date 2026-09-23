import { describe, expect, it } from "vitest";
import { ALL_BRANCHES } from "@/lib/permissions";
import {
  createItemInput,
  reorderItemsInput,
  setItemActiveInput,
} from "@/lib/validation/master-list";

const valid = {
  kind: "category",
  nameEn: "Lehenga",
  nameHi: "लहंगा",
  nameGu: "લહેંગા",
};

const firstIssue = (result: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues[0];

describe("createItemInput", () => {
  it("defaults to every branch when the form sends no choice", () => {
    expect(createItemInput.parse(valid).branchId).toBe(ALL_BRANCHES);
  });

  it("keeps a branch the admin picked", () => {
    expect(createItemInput.parse({ ...valid, branchId: "branch-1" }).branchId).toBe("branch-1");
  });

  it.each([
    ["nameEn", "masterLists.errors.nameEnRequired"],
    ["nameHi", "masterLists.errors.nameHiRequired"],
    ["nameGu", "masterLists.errors.nameGuRequired"],
  ])("needs %s, because a missing one silently falls back to English", (field, message) => {
    const result = createItemInput.safeParse({ ...valid, [field]: "  " });
    expect(firstIssue(result)?.message).toBe(message);
    expect(firstIssue(result)?.path).toEqual([field]);
  });

  it("refuses a name longer than 50 characters", () => {
    const result = createItemInput.safeParse({ ...valid, nameEn: "x".repeat(51) });
    expect(firstIssue(result)?.message).toBe("masterLists.errors.nameTooLong");
  });

  it("refuses a list it does not know", () => {
    expect(createItemInput.safeParse({ ...valid, kind: "colours" }).success).toBe(false);
  });
});

describe("setItemActiveInput", () => {
  it("takes a real boolean, not a checkbox string", () => {
    expect(setItemActiveInput.safeParse({ kind: "reason", id: "r1", active: "on" }).success).toBe(
      false,
    );
    expect(setItemActiveInput.parse({ kind: "reason", id: "r1", active: false }).active).toBe(
      false,
    );
  });
});

describe("reorderItemsInput", () => {
  it("takes the whole list, and refuses an empty one", () => {
    expect(reorderItemsInput.parse({ kind: "category", ids: ["a", "b"] }).ids).toEqual(["a", "b"]);
    expect(reorderItemsInput.safeParse({ kind: "category", ids: [] }).success).toBe(false);
  });
});
