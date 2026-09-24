// The store every module's DB tests run against: **two branches, two managers, two
// salespeople and one admin**.
//
// A one-branch fixture with one person per role hides exactly the bugs that matter in
// this app — branch scoping, the M17 switcher, "All branches" for an admin, and any list
// filtered to a scope. M05 shipped a full green suite while an admin on "All branches"
// could press Save on the new-customer form and have nothing happen at all, because
// every test ran on the author's own home branch.
import { makeBranch, makeUser } from "./branch-access";

export type TestStore = Awaited<ReturnType<typeof makeStore>>;

export async function makeStore() {
  const [branchA, branchB] = await Promise.all([makeBranch(), makeBranch()]);

  // The admin's home branch is A, but being an admin they reach both (permissions.ts).
  const admin = await makeUser({ role: "ADMIN", homeBranchId: branchA.id });
  const [managerA, managerB, salesA, salesB] = await Promise.all([
    makeUser({ role: "MANAGER", homeBranchId: branchA.id }),
    makeUser({ role: "MANAGER", homeBranchId: branchB.id }),
    makeUser({ role: "SALESPERSON", homeBranchId: branchA.id }),
    makeUser({ role: "SALESPERSON", homeBranchId: branchB.id }),
  ]);

  return { branchA, branchB, admin, managerA, managerB, salesA, salesB };
}
