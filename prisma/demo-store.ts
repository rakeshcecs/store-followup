// The demo store's shape, kept out of prisma/seed.ts so it can be tested: importing the
// seed runs it.
//
// Two branches (A and B), a manager and a salesperson in each, named after their home
// branch (Manager A, Salesman B, …) so a screen shows at a glance whose data it is, plus the admin the seed always
// creates. This is the same shape every module's tests use (tests/helpers/store.ts) —
// a one-branch store hides branch scoping, the switcher and "All branches".
import { isBlockedPin } from "@/lib/validation/auth";

// Not NodeJS.ProcessEnv: Next augments that with a required NODE_ENV, which a test
// passing a two-key object would then have to fake.
type Env = Record<string, string | undefined>;

// Not 1234 or 4321: those are blocked (src/lib/validation/auth.ts), so nobody could set
// them from inside the app either.
export const DEFAULT_DEMO_PIN = "2580";

export type DemoPerson = {
  fullName: string;
  mobile: string;
  role: "MANAGER" | "SALESPERSON";
  homeBranchId: string;
  extraBranchIds: string[];
};

export function demoPin(env: Env = process.env): string {
  const value = env["SEED_DEMO_PIN"]?.trim() || DEFAULT_DEMO_PIN;
  if (!/^\d{4}$/.test(value)) throw new Error("SEED_DEMO_PIN must be 4 digits.");
  if (isBlockedPin(value)) throw new Error("SEED_DEMO_PIN is one the app refuses to set.");
  return value;
}

export function demoMobile(name: string, fallback: string, env: Env = process.env): string {
  const value = env[name]?.trim() || fallback;
  if (!/^[6-9]\d{9}$/.test(value)) {
    throw new Error(`${name} must be 10 digits starting with 6, 7, 8 or 9.`);
  }
  return value;
}

// The first manager also covers branch 2, which is the only fixture that exercises extra
// branches, the switcher and "All branches" without editing the database by hand.
export function demoStaff(
  mainBranchId: string,
  branch2Id: string,
  env: Env = process.env,
): DemoPerson[] {
  return [
    {
      fullName: "Manager A",
      mobile: demoMobile("SEED_MANAGER_MOBILE", "9000000001", env),
      role: "MANAGER",
      homeBranchId: mainBranchId,
      // Never the home branch itself: a UserBranch row for it would double-count the
      // person when a branch checks whether any staff still work there.
      extraBranchIds: [branch2Id],
    },
    {
      fullName: "Manager B",
      mobile: demoMobile("SEED_MANAGER2_MOBILE", "9000000002", env),
      role: "MANAGER",
      homeBranchId: branch2Id,
      extraBranchIds: [],
    },
    {
      fullName: "Salesman A",
      mobile: demoMobile("SEED_SALES_MOBILE", "9000000003", env),
      role: "SALESPERSON",
      homeBranchId: mainBranchId,
      extraBranchIds: [],
    },
    {
      fullName: "Salesman B",
      mobile: demoMobile("SEED_SALES2_MOBILE", "9000000004", env),
      role: "SALESPERSON",
      homeBranchId: branch2Id,
      extraBranchIds: [],
    },
  ];
}
