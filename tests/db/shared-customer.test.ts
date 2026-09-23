// BR-16: customers are shared across branches; visits and sales belong to the branch
// where they happened. The customer profile screen is M06 — this proves the data is
// already shaped the way that screen will read it.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  makeBranch,
  makeCustomer,
  makeEnquiry,
  makeUser,
  nextMobile,
} from "../helpers/branch-access";

afterAll(() => db.$disconnect());

describe("a customer who visits two branches", () => {
  it("has one profile that shows both visits, each with its own branch", async () => {
    const [branchA, branchB] = await Promise.all([makeBranch(), makeBranch()]);
    const staffA = await makeUser({ role: "SALESPERSON", homeBranchId: branchA.id });
    const staffB = await makeUser({ role: "SALESPERSON", homeBranchId: branchB.id });

    const mobile = nextMobile();
    const customer = await makeCustomer(branchA.id, staffA.id, mobile);
    const enquiry = await makeEnquiry(customer.id, staffA.id);

    for (const [branch, staff] of [
      [branchA, staffA],
      [branchB, staffB],
    ] as const) {
      await db.visit.create({
        data: {
          branchId: branch.id,
          customerId: customer.id,
          enquiryId: enquiry.id,
          clientId: randomUUID(),
          visitAt: new Date(),
          salespersonId: staff.id,
          outcome: "DECIDE_LATER",
          visitType: "NEW",
        },
      });
      await db.sale.create({
        data: {
          branchId: branch.id,
          customerId: customer.id,
          enquiryId: enquiry.id,
          clientId: randomUUID(),
          billNumber: "INV-001", // same bill number is fine: it is unique per branch
          billDate: new Date("2026-09-20"),
          salespersonId: staff.id,
        },
      });
    }

    // The query the M06 profile will run: by mobile, with no branch filter.
    const profile = await db.customer.findUnique({
      where: { mobile },
      include: {
        visits: { include: { branch: { select: { name: true } } } },
        sales: { include: { branch: { select: { name: true } } } },
      },
    });

    expect(profile?.id).toBe(customer.id);
    expect(profile?.visits).toHaveLength(2);
    expect(profile?.visits.map((visit) => visit.branch.name).sort()).toEqual(
      [branchA.name, branchB.name].sort(),
    );
    expect(profile?.sales.map((sale) => sale.branch.name).sort()).toEqual(
      [branchA.name, branchB.name].sort(),
    );
  });

  it("is still one row per mobile number (see constraints.test.ts for the rejection)", async () => {
    const branch = await makeBranch();
    const staff = await makeUser({ role: "SALESPERSON", homeBranchId: branch.id });
    const mobile = nextMobile();
    await makeCustomer(branch.id, staff.id, mobile);

    expect(await db.customer.count({ where: { mobile } })).toBe(1);
  });
});
