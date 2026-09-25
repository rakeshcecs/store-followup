// Fixtures and the shared assertion for "branch A cannot touch branch B" (M17).
// Every module from M07 on adds one expectBranchIsolated() line per Server Action.
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/errors";

// Random, not a counter: DB test files share one database and each file would
// otherwise start counting from the same number and clash on User.mobile.
export const nextMobile = () =>
  `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;
const unique = () => randomUUID().slice(0, 8);

export function makeBranch(name = `Branch ${unique()}`) {
  return db.branch.create({
    data: { name, address: "12 MG Road", city: "Ahmedabad", phone: "079 1234 5678" },
  });
}

export async function makeUser(options: {
  role: Role;
  homeBranchId: string;
  extraBranchIds?: string[];
  mobile?: string;
}) {
  const user = await db.user.create({
    data: {
      fullName: `Test ${options.role}`,
      mobile: options.mobile ?? nextMobile(),
      role: options.role,
      homeBranchId: options.homeBranchId,
      pinHash: "x",
    },
  });

  for (const branchId of options.extraBranchIds ?? []) {
    // Never the home branch: it would double-count the person when a branch checks
    // whether any staff still work there.
    if (branchId === options.homeBranchId) throw new Error("extra branch = home branch");
    await db.userBranch.create({ data: { userId: user.id, branchId } });
  }
  return user;
}

export async function makeCustomer(homeBranchId: string, assignedToId: string, mobile?: string) {
  return db.customer.create({
    data: {
      name: `Customer ${unique()}`,
      mobile: mobile ?? nextMobile(),
      assignedToId,
      homeBranchId,
    },
  });
}

export function makeEnquiry(customerId: string, assignedToId: string) {
  return db.enquiry.create({ data: { customerId, assignedToId, title: "Wedding" } });
}

// One row in every branch-scoped model, all belonging to one branch.
export async function makeBranchRecords(options: {
  branchId: string;
  userId: string;
  customerId: string;
  enquiryId: string;
}) {
  const { branchId, userId, customerId, enquiryId } = options;

  const visit = await db.visit.create({
    data: {
      branchId,
      customerId,
      enquiryId,
      clientId: randomUUID(),
      visitAt: new Date(),
      salespersonId: userId,
      outcome: "DECIDE_LATER",
      visitType: "NEW",
    },
  });

  const followUp = await db.followUp.create({
    data: {
      branchId,
      customerId,
      enquiryId,
      clientId: randomUUID(),
      dueDate: new Date("2026-10-01"),
      timeSlot: "EVENING",
      method: "CALL",
      assignedToId: userId,
      createdFrom: "VISIT",
    },
  });

  const sale = await db.sale.create({
    data: {
      branchId,
      customerId,
      enquiryId,
      clientId: randomUUID(),
      billNumber: `BILL-${unique()}`,
      billDate: new Date("2026-09-20"),
      salespersonId: userId,
    },
  });

  const importJob = await db.importJob.create({
    data: { branchId, fileName: "customers.xlsx", uploadedById: userId },
  });

  return { visit, followUp, sale, importJob };
}

// Two branches, the staff that go with them, and one full set of records in each.
export async function makeTwoBranchFixture() {
  const [branchA, branchB] = await Promise.all([makeBranch(), makeBranch()]);

  const admin = await makeUser({ role: "ADMIN", homeBranchId: branchA.id });
  const managerA = await makeUser({ role: "MANAGER", homeBranchId: branchA.id });
  const managerAB = await makeUser({
    role: "MANAGER",
    homeBranchId: branchA.id,
    extraBranchIds: [branchB.id],
  });
  const salesB = await makeUser({ role: "SALESPERSON", homeBranchId: branchB.id });

  // A customer per branch: BR-02 allows only one open enquiry and one pending
  // follow-up per customer, so a shared customer could not hold both sets.
  const customerA = await makeCustomer(branchA.id, managerA.id);
  const customerB = await makeCustomer(branchB.id, salesB.id);
  const enquiryA = await makeEnquiry(customerA.id, managerA.id);
  const enquiryB = await makeEnquiry(customerB.id, salesB.id);

  const recordsA = await makeBranchRecords({
    branchId: branchA.id,
    userId: managerA.id,
    customerId: customerA.id,
    enquiryId: enquiryA.id,
  });
  const recordsB = await makeBranchRecords({
    branchId: branchB.id,
    userId: salesB.id,
    customerId: customerB.id,
    enquiryId: enquiryB.id,
  });

  return { branchA, branchB, admin, managerA, managerAB, salesB, recordsA, recordsB };
}

// A Server Action given a record from another branch must refuse, and must not say
// whether that record exists.
export async function expectBranchIsolated<I>(
  action: (input: I) => Promise<ActionResult<unknown>>,
  input: I,
): Promise<void> {
  const result = await action(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(["NOT_FOUND", "FORBIDDEN"]).toContain(result.code);
}
