import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { recordVisit } = await import("@/lib/actions/visit");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { TIMELINE } = await import("@/lib/timeline");
const { isoDate } = await import("@/lib/format");
const { ALL_BRANCHES } = await import("@/lib/permissions");
const { expectBranchIsolated, makeCustomer } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
const { signInAs, viewingBranch } = await import("../helpers/session");

// M07: a visit, its enquiry, and the sale, follow-up or reason it must come with — all in
// one transaction. Two branches, two managers, two salespeople and an admin, every time.
let store: TestStore;
let customer: Awaited<ReturnType<typeof makeCustomer>>;
let sherwani: string;
let wedding: string;
let reason: string;

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => isoDate(new Date(Date.now() + offset * DAY));

function category(nameEn: string, sortOrder: number, branchId: string | null = null) {
  return db.requirementCategory.create({
    data: { nameEn, nameHi: nameEn, nameGu: nameEn, sortOrder, branchId },
  });
}

beforeEach(async () => {
  store = await makeStore();
  customer = await makeCustomer(store.branchA.id, store.salesA.id);
  sherwani = (await category("Sherwani", 1)).id;
  wedding = (await category("Wedding Clothes", 2)).id;
  reason = (
    await db.lostReason.create({
      data: { nameEn: "Price too high", nameHi: "Price", nameGu: "Price" },
    })
  ).id;
  await signInAs(store.salesA.mobile);
});

afterAll(() => db.$disconnect());

const visit = (extra: Record<string, unknown> = {}) => ({
  clientId: randomUUID(),
  customerId: customer.id,
  categoryIds: [wedding, sherwani],
  ...extra,
});
const notInterested = (extra: Record<string, unknown> = {}) =>
  visit({ outcome: "NOT_INTERESTED", lostReasonId: reason, ...extra });
const decideLater = (extra: Record<string, unknown> = {}) =>
  visit({
    outcome: "DECIDE_LATER",
    followUp: { dueDate: day(2), timeSlot: "EVENING", method: "CALL" },
    ...extra,
  });
const bought = (billNumber: string, extra: Record<string, unknown> = {}) =>
  visit({
    outcome: "PURCHASED",
    sale: { billNumber, billDate: day(0), billAmount: 1500 },
    ...extra,
  });

async function saved(result: Awaited<ReturnType<typeof recordVisit>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code} ${result.message}`);
  return db.visit.findUniqueOrThrow({
    where: { id: result.data.visitId },
    include: { enquiry: { include: { categories: true } }, categories: true },
  });
}

describe("recordVisit — the enquiry (M07.09, M07.10)", () => {
  it("opens an enquiry titled from the first two categories", async () => {
    const row = await saved(await recordVisit(decideLater({ remarks: "Liked blue sherwani" })));

    // Admin's order, not the tap order: Sherwani (1) before Wedding Clothes (2).
    expect(row.enquiry.title).toBe("Sherwani, Wedding Clothes");
    expect(row.enquiry.status).toBe("OPEN");
    expect(row.enquiry.assignedToId).toBe(store.salesA.id);
    expect(row.enquiry.latestRemarks).toBe("Liked blue sherwani");
    expect(row.categories).toHaveLength(2);
  });

  it("adds a visit to the open enquiry, keeping its categories and updating the rest", async () => {
    const first = await saved(await recordVisit(decideLater()));
    const suit = (await category("Suit", 3)).id;

    const second = await saved(
      await recordVisit(
        decideLater({
          categoryIds: [suit],
          expectedPurchase: "THIS_WEEK",
          remarks: "Back with dad",
        }),
      ),
    );

    expect(second.enquiryId).toBe(first.enquiryId);
    expect(await db.enquiry.count({ where: { customerId: customer.id } })).toBe(1);
    expect(second.enquiry.categories.map((row) => row.categoryId).sort()).toEqual(
      [sherwani, wedding, suit].sort(),
    );
    expect(second.enquiry.expectedPurchase).toBe("THIS_WEEK");
    expect(second.enquiry.latestRemarks).toBe("Back with dad");
    expect(second.enquiry.title).toBe("Sherwani, Wedding Clothes"); // unchanged
  });

  it("opens a new enquiry once the last one closed", async () => {
    const first = await saved(await recordVisit(notInterested()));
    const second = await saved(await recordVisit(decideLater()));

    expect(second.enquiryId).not.toBe(first.enquiryId);
    expect(second.enquiry.status).toBe("OPEN");
  });
});

describe("recordVisit — visit type (BR-13)", () => {
  it("is New on the first visit, sets firstVisitAt, and stays New the same day", async () => {
    const first = await saved(await recordVisit(decideLater()));
    expect(first.visitType).toBe("NEW");
    const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.firstVisitAt).toBeInstanceOf(Date);

    expect((await saved(await recordVisit(decideLater()))).visitType).toBe("NEW");
    // The first visit's date is not moved by later ones.
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).firstVisitAt,
    ).toEqual(after.firstVisitAt);
  });

  it("is Existing when the first visit was on an earlier day", async () => {
    await db.customer.update({
      where: { id: customer.id },
      data: { firstVisitAt: new Date(Date.now() - 2 * DAY) },
    });

    expect((await saved(await recordVisit(decideLater()))).visitType).toBe("EXISTING");
  });
});

describe("recordVisit — Yes, bought (BR-03, BR-06, BR-07, BR-08)", () => {
  it("saves the sale with the visit, closes the enquiry and cancels the pending follow-up", async () => {
    await saved(await recordVisit(decideLater()));

    const row = await saved(await recordVisit(bought(" inv-101 ")));

    expect(row.outcome).toBe("PURCHASED");
    expect(row.enquiry.status).toBe("SALE_COMPLETED");
    const sale = await db.sale.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(sale.billNumber).toBe("INV-101");
    expect(sale.branchId).toBe(store.branchA.id);
    expect(sale.salespersonId).toBe(store.salesA.id);
    expect(await db.followUp.count({ where: { customerId: customer.id, status: "PENDING" } })).toBe(
      0,
    );
    expect(
      await db.followUp.count({ where: { customerId: customer.id, status: "CANCELLED" } }),
    ).toBe(1);
  });

  it("refuses a bill number already used in the branch, and writes nothing", async () => {
    const bill = `B-${randomUUID().slice(0, 8)}`;
    expect((await recordVisit(bought(bill))).ok).toBe(true);
    const other = await makeCustomer(store.branchA.id, store.salesA.id);

    const again = await recordVisit(bought(bill.toLowerCase(), { customerId: other.id }));

    expect(again).toMatchObject({
      ok: false,
      code: "CONFLICT",
      field: "sale.billNumber",
      values: { name: customer.name },
    });
    expect(await db.visit.count({ where: { customerId: other.id } })).toBe(0);
    expect(await db.enquiry.count({ where: { customerId: other.id } })).toBe(0);
  });

  it("allows the same bill number in another branch", async () => {
    const bill = `B-${randomUUID().slice(0, 8)}`;
    expect((await recordVisit(bought(bill))).ok).toBe(true);
    const other = await makeCustomer(store.branchB.id, store.salesB.id);
    await signInAs(store.salesB.mobile);

    expect((await recordVisit(bought(bill, { customerId: other.id }))).ok).toBe(true);
  });

  it("refuses a bill dated tomorrow", async () => {
    await expect(
      recordVisit(
        visit({
          outcome: "PURCHASED",
          sale: { billNumber: "B-FUTURE", billDate: day(1), billAmount: 1500 },
        }),
      ),
    ).resolves.toMatchObject({ ok: false, message: "visits.errors.billDateFuture" });
  });
});

describe("recordVisit — No, decide later (BR-04, BR-08, M08.06)", () => {
  it("saves the follow-up with the visit, for the customer's salesperson", async () => {
    // A manager records it; the follow-up still goes to the customer's own salesperson.
    await signInAs(store.managerA.mobile);
    const row = await saved(await recordVisit(decideLater()));

    expect(row.salespersonId).toBe(store.managerA.id);
    const followUp = await db.followUp.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(followUp.status).toBe("PENDING");
    expect(followUp.assignedToId).toBe(store.salesA.id);
    expect(followUp.createdFrom).toBe("VISIT");
    expect(followUp.enquiryId).toBe(row.enquiryId);
  });

  it("replaces the pending follow-up, marking the old one Rescheduled", async () => {
    await saved(await recordVisit(decideLater()));
    await saved(await recordVisit(decideLater()));

    const rows = await db.followUp.findMany({ where: { customerId: customer.id } });
    expect(rows.map((row) => row.status).sort()).toEqual(["PENDING", "RESCHEDULED"]);
  });

  it("refuses a follow-up date in the past", async () => {
    await expect(
      recordVisit(
        visit({
          outcome: "DECIDE_LATER",
          followUp: { dueDate: day(-1), timeSlot: "MORNING", method: "CALL" },
        }),
      ),
    ).resolves.toMatchObject({ ok: false, message: "visits.errors.dueDatePast" });
    expect(await db.visit.count({ where: { customerId: customer.id } })).toBe(0);
  });
});

describe("recordVisit — Not interested (BR-05)", () => {
  it("closes the enquiry with the reason and cancels the pending follow-up", async () => {
    await saved(await recordVisit(decideLater()));

    const row = await saved(await recordVisit(notInterested()));

    expect(row.lostReasonId).toBe(reason);
    expect(row.enquiry.status).toBe("NOT_INTERESTED");
    expect(row.enquiry.lostReasonId).toBe(reason);
    expect(row.enquiry.closedAt).toBeInstanceOf(Date);
    expect(await db.followUp.count({ where: { customerId: customer.id, status: "PENDING" } })).toBe(
      0,
    );
  });

  it("writes the timeline and the audit rows", async () => {
    const row = await saved(await recordVisit(notInterested({ remarks: "Too costly" })));

    const events = await db.timelineEvent.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.type)).toEqual([
      TIMELINE.visit.type,
      TIMELINE.notInterested.type,
    ]);
    expect(events[0]?.detail).toBe("Too costly");
    expect(events[1]?.detail).toBe("Price too high");
    // M17: the profile shows which branch each visit was in.
    expect(events.map((event) => event.branchId)).toEqual([row.branchId, row.branchId]);
    expect(
      await db.auditLog.count({ where: { entityId: row.id, action: AUDIT.visitCreate } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: row.enquiryId, action: AUDIT.enquiryClose } }),
    ).toBe(1);
  });
});

describe("recordVisit — safety", () => {
  it("records a visit once, however many times it is sent", async () => {
    const input = notInterested();

    const first = await recordVisit(input);
    const again = await recordVisit(input);

    expect(first.ok && again.ok && again.data.visitId === first.data.visitId).toBe(true);
    expect(await db.visit.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("files the visit under the branch on screen, whoever's customer it is (M17.04)", async () => {
    // Branch B's salesperson serves branch A's customer.
    await signInAs(store.salesB.mobile);

    const row = await saved(await recordVisit(notInterested()));

    expect(row.branchId).toBe(store.branchB.id);
  });

  it("refuses a category that only another branch offers", async () => {
    const branchBOnly = (await category("Branch B special", 9, store.branchB.id)).id;

    await expectBranchIsolated(recordVisit, notInterested({ categoryIds: [branchBOnly] }));
    expect(await db.visit.count({ where: { customerId: customer.id } })).toBe(0);
  });

  it("refuses an inactive reason", async () => {
    await db.lostReason.update({ where: { id: reason }, data: { active: false } });

    await expect(recordVisit(notInterested())).resolves.toMatchObject({
      ok: false,
      field: "lostReasonId",
    });
  });

  it("makes an admin on All branches pick one first", async () => {
    await signInAs(store.admin.mobile);
    viewingBranch(ALL_BRANCHES);

    await expect(recordVisit(notInterested())).resolves.toMatchObject({
      ok: false,
      message: "branch.errors.pickOne",
    });
  });

  it("writes nothing when the follow-up fails after the visit was written", async () => {
    // A follow-up clientId that already exists: the insert fails inside the transaction,
    // after the enquiry and the visit rows were written, and all of it must roll back.
    await saved(await recordVisit(decideLater()));
    const taken = (await db.followUp.findFirstOrThrow({ where: { customerId: customer.id } }))
      .clientId;
    const other = await makeCustomer(store.branchA.id, store.salesA.id);

    const result = await recordVisit(
      decideLater({
        customerId: other.id,
        followUp: { clientId: taken, dueDate: day(2), timeSlot: "EVENING", method: "CALL" },
      }),
    );

    expect(result.ok).toBe(false);
    expect(await db.visit.count({ where: { customerId: other.id } })).toBe(0);
    expect(await db.enquiry.count({ where: { customerId: other.id } })).toBe(0);
    expect(await db.timelineEvent.count({ where: { customerId: other.id } })).toBe(0);
  });

  it("does not record a visit for an inactive customer", async () => {
    await db.customer.update({ where: { id: customer.id }, data: { active: false } });

    await expect(recordVisit(notInterested())).resolves.toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
