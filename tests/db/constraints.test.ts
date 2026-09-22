import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";

const unique = () => randomUUID().slice(0, 8);
let mobileCounter = 9000000000;
const nextMobile = () => String(mobileCounter++);

async function makeBranch() {
  return db.branch.create({
    data: { name: `Branch ${unique()}`, address: "Addr", city: "City", phone: "0000" },
  });
}

async function makeSetup() {
  const branch = await makeBranch();
  const user = await db.user.create({
    data: {
      fullName: "Test Staff",
      mobile: nextMobile(),
      role: "SALESPERSON",
      homeBranchId: branch.id,
      pinHash: "x",
    },
  });
  const customer = await db.customer.create({
    data: {
      name: "Test Customer",
      mobile: nextMobile(),
      assignedToId: user.id,
      homeBranchId: branch.id,
    },
  });
  return { branch, user, customer };
}

function openEnquiry(customerId: string, assignedToId: string) {
  return db.enquiry.create({ data: { customerId, assignedToId, title: "Wedding" } });
}

function pendingFollowUp(s: Awaited<ReturnType<typeof makeSetup>>, enquiryId: string) {
  return db.followUp.create({
    data: {
      branchId: s.branch.id,
      customerId: s.customer.id,
      enquiryId,
      clientId: randomUUID(),
      dueDate: new Date("2026-10-01"),
      timeSlot: "EVENING",
      method: "CALL",
      assignedToId: s.user.id,
      createdFrom: "VISIT",
    },
  });
}

afterAll(() => db.$disconnect());

describe("BR-02: one OPEN enquiry per customer", () => {
  it("blocks a second OPEN enquiry", async () => {
    const s = await makeSetup();
    await openEnquiry(s.customer.id, s.user.id);
    await expect(openEnquiry(s.customer.id, s.user.id)).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows a new OPEN enquiry after the first is closed", async () => {
    const s = await makeSetup();
    const first = await openEnquiry(s.customer.id, s.user.id);
    await db.enquiry.update({
      where: { id: first.id },
      data: { status: "SALE_COMPLETED", closedAt: new Date() },
    });
    await expect(openEnquiry(s.customer.id, s.user.id)).resolves.toMatchObject({ status: "OPEN" });
  });

  it("fills openCustomerId only while OPEN", async () => {
    const s = await makeSetup();
    const e = await openEnquiry(s.customer.id, s.user.id);
    expect(e.openCustomerId).toBe(s.customer.id);
    const closed = await db.enquiry.update({
      where: { id: e.id },
      data: { status: "NOT_INTERESTED" },
    });
    expect(closed.openCustomerId).toBeNull();
  });
});

describe("BR-02: one PENDING follow-up per customer", () => {
  it("blocks a second PENDING follow-up", async () => {
    const s = await makeSetup();
    const e = await openEnquiry(s.customer.id, s.user.id);
    await pendingFollowUp(s, e.id);
    await expect(pendingFollowUp(s, e.id)).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows a new PENDING follow-up after the first is done", async () => {
    const s = await makeSetup();
    const e = await openEnquiry(s.customer.id, s.user.id);
    const first = await pendingFollowUp(s, e.id);
    await db.followUp.update({ where: { id: first.id }, data: { status: "DONE" } });
    await expect(pendingFollowUp(s, e.id)).resolves.toMatchObject({ status: "PENDING" });
  });
});

describe("BR-07: bill numbers are unique within a branch", () => {
  function sale(s: Awaited<ReturnType<typeof makeSetup>>, branchId: string, enquiryId: string) {
    return db.sale.create({
      data: {
        branchId,
        customerId: s.customer.id,
        enquiryId,
        clientId: randomUUID(),
        billNumber: "INV-1001",
        billDate: new Date("2026-09-22"),
        salespersonId: s.user.id,
      },
    });
  }

  it("blocks the same bill number twice in one branch", async () => {
    const s = await makeSetup();
    const e = await openEnquiry(s.customer.id, s.user.id);
    await sale(s, s.branch.id, e.id);
    await expect(sale(s, s.branch.id, e.id)).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows the same bill number in another branch", async () => {
    const s = await makeSetup();
    const other = await makeBranch();
    const e = await openEnquiry(s.customer.id, s.user.id);
    await sale(s, s.branch.id, e.id);
    await expect(sale(s, other.id, e.id)).resolves.toMatchObject({ billNumber: "INV-1001" });
  });
});

describe("Customer mobile", () => {
  it("blocks a duplicate mobile (BR-01)", async () => {
    const s = await makeSetup();
    await expect(
      db.customer.create({
        data: {
          name: "Dup",
          mobile: s.customer.mobile,
          assignedToId: s.user.id,
          homeBranchId: s.branch.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows many customers with no mobile (after privacy delete)", async () => {
    const s = await makeSetup();
    const data = { name: "Deleted", assignedToId: s.user.id, homeBranchId: s.branch.id };
    await db.customer.create({ data });
    await expect(db.customer.create({ data })).resolves.toMatchObject({ mobile: null });
  });
});
