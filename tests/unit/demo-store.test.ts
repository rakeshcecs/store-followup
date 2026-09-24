import { describe, expect, it } from "vitest";
import { DEFAULT_DEMO_PIN, demoMobile, demoPin, demoStaff } from "../../prisma/demo-store";

const MAIN = "branch-main";
const SECOND = "branch-2";
const staff = () => demoStaff(MAIN, SECOND, {});

describe("the demo store", () => {
  it("is two branches with a manager and a salesperson in each", () => {
    const people = staff();
    expect(people).toHaveLength(4);

    for (const branchId of [MAIN, SECOND]) {
      const here = people.filter((person) => person.homeBranchId === branchId);
      expect(here.map((person) => person.role).sort()).toEqual(["MANAGER", "SALESPERSON"]);
    }
  });

  it("gives exactly one person a second branch, so the switcher can be tried", () => {
    const withExtra = staff().filter((person) => person.extraBranchIds.length > 0);
    expect(withExtra).toHaveLength(1);
    expect(withExtra[0]!.role).toBe("MANAGER");
    expect(withExtra[0]!.homeBranchId).toBe(MAIN);
    expect(withExtra[0]!.extraBranchIds).toEqual([SECOND]);
  });

  it("never lists somebody's own branch as an extra one", () => {
    // A UserBranch row for the home branch double-counts the person when a branch checks
    // whether any staff still work there (M17).
    for (const person of staff()) {
      expect(person.extraBranchIds).not.toContain(person.homeBranchId);
    }
  });

  it("gives everyone a different number", () => {
    const mobiles = staff().map((person) => person.mobile);
    expect(new Set(mobiles).size).toBe(mobiles.length);
  });

  it("lets each number be overridden, and refuses one that is not a mobile", () => {
    expect(demoMobile("SEED_SALES_MOBILE", "9000000003", {})).toBe("9000000003");
    expect(demoMobile("SEED_SALES_MOBILE", "9000000003", { SEED_SALES_MOBILE: "9812300011" })).toBe(
      "9812300011",
    );
    expect(() =>
      demoMobile("SEED_SALES_MOBILE", "9000000003", { SEED_SALES_MOBILE: "12345" }),
    ).toThrow();
  });
});

describe("the demo PIN", () => {
  it("defaults to one the app would also let a person choose", () => {
    expect(demoPin({})).toBe(DEFAULT_DEMO_PIN);
  });

  it("refuses a PIN the app itself blocks, so nobody is handed an unusable one", () => {
    // Otherwise the first PIN change would refuse the very PIN we just handed out.
    expect(() => demoPin({ SEED_DEMO_PIN: "1234" })).toThrow();
    expect(() => demoPin({ SEED_DEMO_PIN: "0000" })).toThrow();
    expect(() => demoPin({ SEED_DEMO_PIN: "12" })).toThrow();
    expect(demoPin({ SEED_DEMO_PIN: "8413" })).toBe("8413");
  });
});
