import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { cancelSale, checkBill, recordSale, updateSale } = await import("@/lib/actions/sale");
const { recordVisit } = await import("@/lib/actions/visit");
const { updateSalesSettings } = await import("@/lib/actions/settings");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { TIMELINE } = await import("@/lib/timeline");
const { isoDate } = await import("@/lib/format");
const { SETTING, billAmountRequired } = await import("@/lib/settings");
const { expectBranchIsolated, makeCustomer, makeEnquiry } =
  await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
const { signInAs, viewingBranch } = await import("../helpers/session");

// M10: the sale, its bill number, and a manager correcting or cancelling it. Two
// branches, two managers, two salespeople and an admin, every time.
let store: TestStore;
let customer: Awaited<ReturnType<typeof makeCustomer>>;

const today = () => isoDate(new Date());
const bill = () => `INV-${randomUUID().slice(0, 8)}`.toUpperCase();
const sale = (billNumber: string, extra: Record<string, unknown> = {}) => ({
  billNumber,
  billDate: today(),
  billAmount: 2500,
  ...extra,
});
const onEnquiry = (billNumber: string, extra: Record<string, unknown> = {}) => ({
  clientId: randomUUID(),
  customerId: customer.id,
  sale: sale(billNumber, extra),
});

beforeEach(async () => {
  store = await makeStore();
  customer = await makeCustomer(store.branchA.id, store.salesA.id);
  await signInAs(store.salesA.mobile);
});

// The setting is store-wide; put it back so the next test starts from the default.
afterEach(() => db.setting.deleteMany({ where: { key: SETTING.billAmountRequired } }));
afterAll(() => db.$disconnect());

async function saleOf(result: Awaited<ReturnType<typeof recordSale>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code} ${result.message}`);
  return db.sale.findUniqueOrThrow({ where: { id: result.data.saleId } });
}

describe("recordSale — Sale done from the profile", () => {
  it("adds the sale to the open enquiry and closes it (M10.07)", async () => {
    const enquiry = await makeEnquiry(customer.id, store.salesA.id);
    await db.followUp.create({
      data: {
        branchId: store.branchA.id,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${today()}T00:00:00.000Z`),
        timeSlot: "EVENING",
        method: "CALL",
        assignedToId: store.salesA.id,
        createdFrom: "VISIT",
      },
    });

    const row = await saleOf(await recordSale(onEnquiry(" inv-77a ")));

    expect(row.billNumber).toBe("INV-77A");
    expect(row.enquiryId).toBe(enquiry.id);
    expect(row.salespersonId).toBe(store.salesA.id);
    expect(row.branchId).toBe(store.branchA.id);
    expect((await db.enquiry.findUniqueOrThrow({ where: { id: enquiry.id } })).status).toBe(
      "SALE_COMPLETED",
    );
    expect(await db.followUp.count({ where: { customerId: customer.id, status: "PENDING" } })).toBe(
      0,
    );

    const event = await db.timelineEvent.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(event.type).toBe(TIMELINE.saleCompleted.type);
    expect(event.detail).toBe("INV-77A");
    expect(event.entityId).toBe(row.id); // so the profile can open the sale
  });

  it("refuses when there is no open enquiry — the purchase is a visit", async () => {
    await expect(recordSale(onEnquiry(bill()))).resolves.toMatchObject({
      ok: false,
      code: "RULE",
      message: "sales.errors.noOpenEnquiry",
    });
  });

  it("links the enquiry's last completed follow-up (M10.08, BR-11)", async () => {
    const enquiry = await makeEnquiry(customer.id, store.salesA.id);
    const done = await db.followUp.create({
      data: {
        branchId: store.branchA.id,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        dueDate: new Date(`${today()}T00:00:00.000Z`),
        timeSlot: "MORNING",
        method: "CALL",
        assignedToId: store.salesA.id,
        createdFrom: "VISIT",
        status: "DONE",
        completedAt: new Date(),
      },
    });

    const row = await saleOf(await recordSale(onEnquiry(bill())));

    expect(row.linkedFollowUpId).toBe(done.id);
    expect(row.fromFollowUp).toBe(true);
  });

  it("records a sale once, however many times it is sent", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    const input = onEnquiry(bill());

    const first = await recordSale(input);
    const again = await recordSale(input);

    expect(first.ok && again.ok && first.data.saleId === again.data.saleId).toBe(true);
    expect(await db.sale.count({ where: { customerId: customer.id } })).toBe(1);
  });
});

describe("bill numbers (BR-07, M10.01–M10.03)", () => {
  it("refuses a bill already saved in the branch, naming the customer and the date", async () => {
    const number = bill();
    await makeEnquiry(customer.id, store.salesA.id);
    await saleOf(await recordSale(onEnquiry(number)));
    const other = await makeCustomer(store.branchA.id, store.salesA.id);
    await makeEnquiry(other.id, store.salesA.id);

    const again = await recordSale({
      clientId: randomUUID(),
      customerId: other.id,
      sale: sale(number.toLowerCase()),
    });

    expect(again).toMatchObject({
      ok: false,
      code: "CONFLICT",
      field: "sale.billNumber",
      values: { name: customer.name },
    });
    if (!again.ok) expect(again.values?.["date"]).toBeTruthy();
  });

  it("lets another branch use the same number", async () => {
    const number = bill();
    await makeEnquiry(customer.id, store.salesA.id);
    await saleOf(await recordSale(onEnquiry(number)));
    const other = await makeCustomer(store.branchB.id, store.salesB.id);
    await makeEnquiry(other.id, store.salesB.id);
    await signInAs(store.salesB.mobile);

    const row = await saleOf(
      await recordSale({ clientId: randomUUID(), customerId: other.id, sale: sale(number) }),
    );
    expect(row.branchId).toBe(store.branchB.id);
  });

  it("lets only one of two people saving the same bill at the same moment through", async () => {
    const number = bill();
    const a = await makeCustomer(store.branchA.id, store.salesA.id);
    const b = await makeCustomer(store.branchA.id, store.salesA.id);
    await makeEnquiry(a.id, store.salesA.id);
    await makeEnquiry(b.id, store.salesA.id);

    const results = await Promise.all(
      [a, b].map((person) =>
        recordSale({ clientId: randomUUID(), customerId: person.id, sale: sale(number) }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: "CONFLICT" });
    expect(await db.sale.count({ where: { branchId: store.branchA.id, billNumber: number } })).toBe(
      1,
    );
  });

  it("still blocks the number of a cancelled sale", async () => {
    const number = bill();
    await makeEnquiry(customer.id, store.salesA.id);
    const row = await saleOf(await recordSale(onEnquiry(number)));
    await db.sale.update({ where: { id: row.id }, data: { cancelled: true } });

    await expect(checkBill({ billNumber: number })).resolves.toMatchObject({
      ok: true,
      data: { free: false, name: customer.name },
    });
  });

  it("checkBill answers free for a new number, after normalising it", async () => {
    await expect(checkBill({ billNumber: "  new-number-1 " })).resolves.toEqual({
      ok: true,
      data: { free: true },
    });
  });

  it("refuses a bill dated in the future (BR-08)", async () => {
    await makeEnquiry(customer.id, store.salesA.id);
    const tomorrow = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

    await expect(recordSale(onEnquiry(bill(), { billDate: tomorrow }))).resolves.toMatchObject({
      ok: false,
      message: "visits.errors.billDateFuture",
    });
  });
});

describe("bill amount setting (SOW Open point #1)", () => {
  it("is required by default, and the admin can switch that off", async () => {
    expect(await billAmountRequired()).toBe(true);
    await makeEnquiry(customer.id, store.salesA.id);

    await expect(recordSale(onEnquiry(bill(), { billAmount: undefined }))).resolves.toMatchObject({
      ok: false,
      field: "sale.billAmount",
    });

    // Only the admin may change it.
    await expect(updateSalesSettings({ billAmountRequired: false })).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    await signInAs(store.admin.mobile);
    expect((await updateSalesSettings({ billAmountRequired: false })).ok).toBe(true);
    expect(await billAmountRequired()).toBe(false);
    expect(
      await db.auditLog.count({
        where: { entityId: SETTING.billAmountRequired, action: AUDIT.settingUpdate },
      }),
    ).toBeGreaterThanOrEqual(1);

    await signInAs(store.salesA.mobile);
    expect((await recordSale(onEnquiry(bill(), { billAmount: undefined }))).ok).toBe(true);
  });

  it("applies to a sale recorded with its visit too", async () => {
    const category = await db.requirementCategory.create({
      data: { nameEn: "Suit", nameHi: "Suit", nameGu: "Suit" },
    });

    await expect(
      recordVisit({
        clientId: randomUUID(),
        customerId: customer.id,
        categoryIds: [category.id],
        outcome: "PURCHASED",
        sale: sale(bill(), { billAmount: undefined }),
      }),
    ).resolves.toMatchObject({ ok: false, field: "sale.billAmount" });
    expect(await db.visit.count({ where: { customerId: customer.id } })).toBe(0);
  });
});

describe("updateSale and cancelSale (M10.09)", () => {
  async function savedSale() {
    await makeEnquiry(customer.id, store.salesA.id);
    return saleOf(await recordSale(onEnquiry(bill())));
  }

  const edit = (row: { id: string; billNumber: string }, extra: Record<string, unknown> = {}) => ({
    id: row.id,
    billNumber: row.billNumber,
    billDate: today(),
    billAmount: 3000,
    salespersonId: store.salesA.id,
    reason: "Typed the wrong amount",
    ...extra,
  });

  it("refuses a salesperson", async () => {
    const row = await savedSale();

    await expect(updateSale(edit(row))).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(cancelSale({ id: row.id, reason: "x" })).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("lets the branch manager correct it, with a reason, auditing old and new", async () => {
    const row = await savedSale();
    await signInAs(store.managerA.mobile);

    expect((await updateSale(edit(row, { salespersonId: store.managerA.id }))).ok).toBe(true);

    const after = await db.sale.findUniqueOrThrow({ where: { id: row.id } });
    expect(Number(after.billAmount)).toBe(3000);
    expect(after.salespersonId).toBe(store.managerA.id);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: row.id, action: AUDIT.saleUpdate },
    });
    expect(audit.oldValue).toMatchObject({ salespersonId: store.salesA.id });
    expect(audit.newValue).toMatchObject({
      salespersonId: store.managerA.id,
      reason: "Typed the wrong amount",
    });
    const event = await db.timelineEvent.findFirstOrThrow({
      where: { customerId: customer.id, type: TIMELINE.saleEdited.type },
    });
    expect(event.detail).toBe("Typed the wrong amount");
    expect(event.entityId).toBe(row.id);
  });

  it("needs a reason", async () => {
    const row = await savedSale();
    await signInAs(store.managerA.mobile);

    await expect(updateSale(edit(row, { reason: " " }))).resolves.toMatchObject({ ok: false });
    await expect(cancelSale({ id: row.id, reason: "" })).resolves.toMatchObject({ ok: false });
  });

  it("does not let another branch's manager find it", async () => {
    const row = await savedSale();
    await signInAs(store.managerB.mobile);

    await expectBranchIsolated(updateSale, edit(row));
    await expectBranchIsolated(cancelSale, { id: row.id, reason: "Not ours" });
  });

  it("lets a manager of both branches change it whichever branch the switcher shows", async () => {
    const row = await savedSale(); // in branch A
    await db.userBranch.create({ data: { userId: store.managerB.id, branchId: store.branchA.id } });
    await signInAs(store.managerB.mobile);
    viewingBranch(store.branchB.id);

    expect((await updateSale(edit(row))).ok).toBe(true);
    expect((await cancelSale({ id: row.id, reason: "Returned" })).ok).toBe(true);
  });

  it("files every sale row of the history under the sale's branch (M17)", async () => {
    const row = await savedSale();
    await signInAs(store.managerA.mobile);
    await updateSale(edit(row));
    await cancelSale({ id: row.id, reason: "Returned" });

    const rows = await db.timelineEvent.findMany({ where: { customerId: customer.id } });
    expect(rows.map((r) => r.type).sort()).toEqual(
      [TIMELINE.saleCancelled.type, TIMELINE.saleCompleted.type, TIMELINE.saleEdited.type].sort(),
    );
    expect(rows.every((r) => r.branchId === store.branchA.id)).toBe(true);
  });

  it("refuses a salesperson from another branch as the new credit", async () => {
    const row = await savedSale();
    await signInAs(store.managerA.mobile);

    await expect(updateSale(edit(row, { salespersonId: store.salesB.id }))).resolves.toMatchObject({
      ok: false,
      field: "salespersonId",
    });
  });

  it("cancels without deleting, and a cancelled sale cannot be edited", async () => {
    const row = await savedSale();
    await signInAs(store.admin.mobile);

    expect((await cancelSale({ id: row.id, reason: "Customer returned it" })).ok).toBe(true);

    const after = await db.sale.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.cancelled).toBe(true);
    expect(after.cancelReason).toBe("Customer returned it");
    expect(after.cancelledById).toBe(store.admin.id);
    expect(
      await db.timelineEvent.count({
        where: { customerId: customer.id, type: TIMELINE.saleCancelled.type, entityId: row.id },
      }),
    ).toBe(1);
    await expect(updateSale(edit(row))).resolves.toMatchObject({
      ok: false,
      message: "sales.errors.cancelled",
    });
  });
});
