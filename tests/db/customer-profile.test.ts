import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateCustomer } = await import("@/lib/actions/customer");
const { customerProfile, customerTimeline } = await import("@/lib/customers");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { TIMELINE } = await import("@/lib/timeline");
const { makeCustomer, makeEnquiry, makeUser, nextMobile } =
  await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
const { signInAs } = await import("../helpers/session");

// M06: the profile, its history, and who may change what. Two branches, two managers,
// two salespeople and an admin, every time.
let store: TestStore;
let customer: Awaited<ReturnType<typeof makeCustomer>>;

beforeEach(async () => {
  store = await makeStore();
  // Branch A's salesperson looks after this customer.
  customer = await makeCustomer(store.branchA.id, store.salesA.id);
});

afterAll(() => db.$disconnect());

const edit = (extra: Record<string, unknown> = {}) => ({
  id: customer.id,
  name: customer.name,
  ...extra,
});

describe("updateCustomer", () => {
  it("lets the assigned salesperson edit, and writes the timeline and audit rows", async () => {
    await signInAs(store.salesA.mobile);

    const result = await updateCustomer(edit({ area: "Satellite", city: "Ahmedabad" }));

    expect(result.ok).toBe(true);
    const saved = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(saved.area).toBe("Satellite");
    expect(saved.updatedById).toBe(store.salesA.id); // SOW 5.3 "updated on, by"

    const event = await db.timelineEvent.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(event.type).toBe(TIMELINE.detailsEdited.type);
    expect(event.staffId).toBe(store.salesA.id);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: customer.id, action: AUDIT.customerUpdate },
    });
    // Only what changed, old and new.
    expect(audit.oldValue).toEqual({ area: null, city: null });
    expect(audit.newValue).toEqual({ area: "Satellite", city: "Ahmedabad" });
  });

  it("writes nothing when nothing changed", async () => {
    await signInAs(store.salesA.mobile);

    expect((await updateCustomer(edit())).ok).toBe(true);

    expect(await db.timelineEvent.count({ where: { customerId: customer.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: customer.id } })).toBe(0);
  });

  it("clears a field that was emptied", async () => {
    await db.customer.update({ where: { id: customer.id }, data: { area: "Satellite" } });
    await signInAs(store.salesA.mobile);

    await updateCustomer(edit({ area: "" }));

    expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).area).toBeNull();
  });

  it("refuses another salesperson's customer, in the same branch or another (M06.07)", async () => {
    const colleague = await makeUser({ role: "SALESPERSON", homeBranchId: store.branchA.id });

    for (const mobile of [colleague.mobile, store.salesB.mobile]) {
      await signInAs(mobile);
      await expect(updateCustomer(edit({ area: "Maninagar" }))).resolves.toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
    expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).area).toBeNull();
  });

  it("lets any manager or the admin edit, whichever branch they work in", async () => {
    for (const person of [store.managerA, store.managerB, store.admin]) {
      await signInAs(person.mobile);
      const area = `Area ${person.id.slice(-4)}`;
      expect((await updateCustomer(edit({ area }))).ok).toBe(true);
      expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).area).toBe(area);
    }
  });

  it("refuses a new mobile from a salesperson, even on their own customer", async () => {
    await signInAs(store.salesA.mobile);

    const result = await updateCustomer(edit({ mobile: nextMobile() }));

    expect(result).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      field: "mobile",
      message: "customers.errors.mobileManagerOnly",
    });
    // Sending the same number back is not a change, so it passes.
    expect((await updateCustomer(edit({ mobile: customer.mobile }))).ok).toBe(true);
  });

  it("lets a manager change the mobile", async () => {
    await signInAs(store.managerA.mobile);
    const mobile = nextMobile();

    expect((await updateCustomer(edit({ mobile }))).ok).toBe(true);
    expect((await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).mobile).toBe(
      mobile,
    );
  });

  it("refuses a mobile that belongs to someone else, main or alternate (BR-01)", async () => {
    const other = await makeCustomer(store.branchB.id, store.salesB.id);
    const altOwner = await db.customer.create({
      data: {
        name: "Alt Owner",
        mobile: nextMobile(),
        altMobile: nextMobile(),
        assignedToId: store.salesB.id,
        homeBranchId: store.branchB.id,
      },
    });
    await signInAs(store.managerA.mobile);

    for (const [mobile, name] of [
      [other.mobile, other.name],
      [altOwner.altMobile, altOwner.name],
    ]) {
      await expect(updateCustomer(edit({ mobile }))).resolves.toMatchObject({
        ok: false,
        code: "CONFLICT",
        field: "mobile",
        values: { name },
      });
    }
    expect(await db.timelineEvent.count({ where: { customerId: customer.id } })).toBe(0);
  });

  it("refuses an alternate number that is someone else's number (BR-01)", async () => {
    const other = await makeCustomer(store.branchB.id, store.salesB.id);
    await signInAs(store.salesA.mobile);

    await expect(updateCustomer(edit({ altMobile: other.mobile }))).resolves.toMatchObject({
      ok: false,
      code: "CONFLICT",
      field: "altMobile",
      values: { name: other.name },
    });
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).altMobile,
    ).toBeNull();
  });

  it("refuses the customer's own main number as the alternate, even without a mobile box", async () => {
    // A salesperson's form sends no mobile, so only the action can see the clash.
    await signInAs(store.salesA.mobile);

    await expect(updateCustomer(edit({ altMobile: customer.mobile }))).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION",
      field: "altMobile",
      message: "customers.errors.altSameAsMobile",
    });
  });

  it("refuses to save, unchanged, a customer already stored with alternate = main", async () => {
    // Rows saved before the rule existed. Pressing Save with nothing changed must still
    // say so, or the bad row can never be noticed.
    await db.customer.update({
      where: { id: customer.id },
      data: { altMobile: customer.mobile },
    });
    await signInAs(store.salesA.mobile);

    await expect(updateCustomer(edit({ altMobile: customer.mobile }))).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION",
      field: "altMobile",
    });
    // Emptying the box fixes it.
    expect((await updateCustomer(edit({ altMobile: "" }))).ok).toBe(true);
  });

  it("does not find an inactive customer", async () => {
    await db.customer.update({ where: { id: customer.id }, data: { active: false } });
    await signInAs(store.managerA.mobile);

    await expect(updateCustomer(edit({ area: "X" }))).resolves.toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe("customerProfile", () => {
  it("is New customer with no enquiry, Visited with an open one", async () => {
    expect((await customerProfile(customer.id))?.status).toBe("new");

    await makeEnquiry(customer.id, store.salesA.id);
    const profile = await customerProfile(customer.id);
    expect(profile?.status).toBe("visited");
    expect(profile?.openEnquiry?.title).toBe("Wedding");
  });

  it("goes by the newest enquiry, so an old sale does not hide a new open one", async () => {
    const old = await makeEnquiry(customer.id, store.salesA.id);
    await db.enquiry.update({
      where: { id: old.id },
      data: { status: "SALE_COMPLETED", closedAt: new Date(), createdAt: new Date("2025-01-01") },
    });
    const closed = await customerProfile(customer.id);
    expect(closed?.status).toBe("saleCompleted");
    expect(closed?.openEnquiry).toBeNull();

    await makeEnquiry(customer.id, store.salesA.id);
    expect((await customerProfile(customer.id))?.status).toBe("visited");
  });
});

describe("customerTimeline", () => {
  it("is newest first, and asking for more never repeats a row", async () => {
    const start = Date.parse("2026-09-01T00:00:00.000Z");
    await db.timelineEvent.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        customerId: customer.id,
        staffId: store.salesA.id,
        type: TIMELINE.visit.type,
        title: TIMELINE.visit.title,
        detail: `Visit ${index}`,
        createdAt: new Date(start + index * 60_000),
      })),
    });

    const first = await customerTimeline(customer.id, 20);
    expect(first.events).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(first.events[0]?.detail).toBe("Visit 24");
    expect(first.events[0]?.staffName).toBe(store.salesA.fullName);

    const more = await customerTimeline(customer.id, 40);
    expect(more.hasMore).toBe(false);
    expect(more.events).toHaveLength(25);
    expect(more.events.slice(0, 20).map((event) => event.id)).toEqual(
      first.events.map((event) => event.id),
    );
    expect(new Set(more.events.map((event) => event.id)).size).toBe(25);
  });

  it("names the branch of a row that has one (M17), and none for the rest", async () => {
    await db.timelineEvent.create({
      data: {
        customerId: customer.id,
        staffId: store.salesB.id,
        type: TIMELINE.visit.type,
        title: TIMELINE.visit.title,
        branchId: store.branchB.id,
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
      },
    });
    await db.timelineEvent.create({
      data: {
        customerId: customer.id,
        staffId: store.salesA.id,
        type: TIMELINE.customerAdded.type,
        title: TIMELINE.customerAdded.title,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    const { events } = await customerTimeline(customer.id, 20);
    expect(events.map((event) => event.branchName)).toEqual([store.branchB.name, null]);
  });
});
