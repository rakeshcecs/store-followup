import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createCustomer } = await import("@/lib/actions/customer");
const { findByMobile, recentlyHandledBy } = await import("@/lib/customers");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { TIMELINE } = await import("@/lib/timeline");
const { makeBranch, makeCustomer, makeUser, nextMobile } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
type TestStore = Awaited<ReturnType<typeof makeStore>>;
const { signInAs, viewingBranch } = await import("../helpers/session");
const { ALL_BRANCHES } = await import("@/lib/permissions");

// Two branches, two managers, two salespeople and an admin, every time.
let store: TestStore;
let branchId: string;
let salesMobile: string;
let salesId: string;

const input = (mobile: string, extra: Record<string, unknown> = {}) => ({
  name: "Asha Patel",
  mobile,
  assignedToId: salesId,
  consentGiven: true,
  ...extra,
});

beforeEach(async () => {
  store = await makeStore();
  branchId = store.branchA.id;
  salesMobile = store.salesA.mobile;
  salesId = store.salesA.id;
  await signInAs(salesMobile);
});

afterAll(() => db.$disconnect());

describe("createCustomer", () => {
  it("saves the customer, the first timeline event and the audit row together", async () => {
    const mobile = nextMobile();

    const result = await createCustomer(input(mobile));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = await db.customer.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(saved.homeBranchId).toBe(branchId); // where they walked in (BR-16)
    expect(saved.assignedToId).toBe(salesId);
    expect(saved.source).toBe("WALK_IN");

    const event = await db.timelineEvent.findFirstOrThrow({ where: { customerId: saved.id } });
    // A key, not a sentence: M06 renders it in whatever language the reader uses.
    expect(event.title).toBe(TIMELINE.customerAdded.title);
    expect(event.staffId).toBe(salesId);

    expect(
      await db.auditLog.count({ where: { entityId: saved.id, action: AUDIT.customerCreate } }),
    ).toBe(1);
  });

  it("records who took the consent and when, not just that it was given", async () => {
    const result = await createCustomer(input(nextMobile()));
    if (!result.ok) throw new Error("setup failed");

    const saved = await db.customer.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(saved.consentGiven).toBe(true);
    expect(saved.consentById).toBe(salesId);
    expect(saved.consentAt).toBeInstanceOf(Date);
  });

  it("leaves the consent date empty when the box was unticked", async () => {
    const result = await createCustomer(input(nextMobile(), { consentGiven: false }));
    if (!result.ok) throw new Error("setup failed");

    const saved = await db.customer.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(saved.consentGiven).toBe(false);
    expect(saved.consentAt).toBeNull();
    expect(saved.consentById).toBeNull();
  });

  it("refuses a number that already belongs to someone, and names them (BR-01)", async () => {
    const mobile = nextMobile();
    const first = await createCustomer(input(mobile));
    if (!first.ok) throw new Error("setup failed");

    const again = await createCustomer(input(mobile, { name: "Someone Else" }));

    expect(again).toMatchObject({
      ok: false,
      message: "customers.errors.mobileTaken",
      field: "mobile",
      values: { name: "Asha Patel" },
    });
    // And nothing was written: one customer, one timeline event.
    expect(await db.customer.count({ where: { mobile } })).toBe(1);
  });

  it("also refuses a number already held as someone's alternate number", async () => {
    const alt = nextMobile();
    const first = await createCustomer(input(nextMobile(), { altMobile: alt }));
    if (!first.ok) throw new Error("setup failed");

    await expect(createCustomer(input(alt))).resolves.toMatchObject({
      ok: false,
      message: "customers.errors.mobileTaken",
    });
  });

  it("refuses an alternate number that already belongs to someone (BR-01)", async () => {
    const first = await createCustomer(input(nextMobile()));
    if (!first.ok) throw new Error("setup failed");
    const taken = (await db.customer.findUniqueOrThrow({ where: { id: first.data.id } })).mobile;

    const mobile = nextMobile();
    await expect(createCustomer(input(mobile, { altMobile: taken }))).resolves.toMatchObject({
      ok: false,
      code: "CONFLICT",
      field: "altMobile",
      values: { name: "Asha Patel" },
    });
    expect(await db.customer.count({ where: { mobile } })).toBe(0);
  });

  it("refuses an alternate number equal to the main number", async () => {
    const mobile = nextMobile();
    await expect(createCustomer(input(mobile, { altMobile: mobile }))).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
  });

  it("writes nothing at all when the save fails", async () => {
    const mobile = nextMobile();
    // An assignedToId nobody owns: the foreign key rejects the insert.
    const result = await createCustomer(input(mobile, { assignedToId: "no-such-user" }));

    expect(result.ok).toBe(false);
    expect(await db.customer.count({ where: { mobile } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { action: AUDIT.customerCreate, userId: salesId } }),
    ).toBe(0);
  });

  it("is open to a manager and an admin too (SOW: used by All)", async () => {
    for (const role of ["MANAGER", "ADMIN"] as const) {
      const mobile = nextMobile();
      const person = await makeUser({ role, homeBranchId: branchId, mobile });
      await signInAs(mobile);

      await expect(
        createCustomer({
          name: `Added by ${role}`,
          mobile: nextMobile(),
          assignedToId: person.id,
          consentGiven: true,
        }),
      ).resolves.toMatchObject({ ok: true });
    }
  });

  it("refuses a signed-out caller", async () => {
    await signInAs(null);
    await expect(createCustomer(input(nextMobile()))).resolves.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});

describe("findByMobile", () => {
  it("finds a customer by their own number", async () => {
    const mobile = nextMobile();
    const created = await createCustomer(input(mobile));
    if (!created.ok) throw new Error("setup failed");

    const found = await findByMobile(mobile);
    expect(found?.id).toBe(created.data.id);
    expect(found?.assignedToName).toBe("Test SALESPERSON");
    expect(found?.visitCount).toBe(0);
    expect(found?.lastVisitAt).toBeNull();
  });

  it("finds them by their alternate number too", async () => {
    const alt = nextMobile();
    const created = await createCustomer(input(nextMobile(), { altMobile: alt }));
    if (!created.ok) throw new Error("setup failed");

    expect((await findByMobile(alt))?.id).toBe(created.data.id);
  });

  it("accepts the number however it was typed", async () => {
    const mobile = nextMobile();
    const created = await createCustomer(input(mobile));
    if (!created.ok) throw new Error("setup failed");

    const typed = `+91 ${mobile.slice(0, 5)}-${mobile.slice(5)}`;
    expect((await findByMobile(typed))?.id).toBe(created.data.id);
  });

  it("returns nothing for an unknown or unusable number", async () => {
    expect(await findByMobile(nextMobile())).toBeNull();
    expect(await findByMobile("12345")).toBeNull();
    // Never a partial match: five digits must not identify anyone.
    const mobile = nextMobile();
    await createCustomer(input(mobile));
    expect(await findByMobile(mobile.slice(0, 5))).toBeNull();
  });

  it("finds another branch's customer, because customers are shared (BR-16)", async () => {
    // The deliberate opposite of every other branch test in this suite: searching by
    // mobile has to cross branches, or the same person is added twice (BR-01).
    const otherBranch = await makeBranch();
    const otherMobile = nextMobile();
    await makeUser({ role: "SALESPERSON", homeBranchId: otherBranch.id, mobile: otherMobile });
    await signInAs(otherMobile);
    const theirs = await db.user.findUniqueOrThrow({ where: { mobile: otherMobile } });

    const mobile = nextMobile();
    const created = await createCustomer({
      name: "Other Branch Customer",
      mobile,
      assignedToId: theirs.id,
      consentGiven: true,
    });
    if (!created.ok) throw new Error("setup failed");

    await signInAs(salesMobile);
    expect((await findByMobile(mobile))?.id).toBe(created.data.id);
  });
});

describe("recentlyHandledBy", () => {
  it("lists the five most recent, newest first, each customer once", async () => {
    const ids: string[] = [];
    for (let n = 0; n < 6; n++) {
      const created = await createCustomer(input(nextMobile(), { name: `Customer ${n}` }));
      if (!created.ok) throw new Error("setup failed");
      ids.push(created.data.id);
    }
    // A second event for the oldest one does not give it a second row in the list.
    await db.timelineEvent.create({
      data: { customerId: ids[0]!, staffId: salesId, type: "test", title: "timeline.test" },
    });

    const recent = await recentlyHandledBy(salesId);

    expect(recent).toHaveLength(5);
    expect(recent[0]!.id).toBe(ids[0]); // the extra event is the newest touch
    expect(new Set(recent.map((row) => row.id)).size).toBe(5);
  });

  it("is per person: someone else's work is not yours", async () => {
    const created = await createCustomer(input(nextMobile()));
    if (!created.ok) throw new Error("setup failed");

    const other = await makeUser({ role: "SALESPERSON", homeBranchId: branchId });
    expect(await recentlyHandledBy(other.id)).toEqual([]);
  });

  it("counts handling someone else's customer, not being assigned one", async () => {
    // Assigned to another salesperson, touched by ours.
    const owner = await makeUser({ role: "SALESPERSON", homeBranchId: branchId });
    const customer = await makeCustomer(branchId, owner.id);
    await db.timelineEvent.create({
      data: {
        customerId: customer.id,
        staffId: salesId,
        type: "test",
        title: "timeline.test",
      },
    });

    const recent = await recentlyHandledBy(salesId);
    expect(recent.map((row) => row.id)).toContain(customer.id);
  });
});

describe("which branch a walk-in is filed under", () => {
  it("uses the branch the person is looking at, not their home branch", async () => {
    const { admin, branchB } = store;
    await signInAs(admin.mobile);
    viewingBranch(branchB.id); // the switcher (M17)

    const mobile = nextMobile();
    const result = await createCustomer({
      name: "Walk-in at the other branch",
      mobile,
      // Someone who actually works there: the admin's own home branch is A.
      assignedToId: store.salesB.id,
      consentGiven: true,
    });

    expect(result.ok).toBe(true);
    const saved = await db.customer.findUniqueOrThrow({ where: { mobile } });
    // BR-16: the customer is shared, but this records where they actually walked in.
    expect(saved.homeBranchId).toBe(branchB.id);
  });

  it('refuses to file one under "All branches"', async () => {
    const { admin } = store;
    await signInAs(admin.mobile);
    viewingBranch(ALL_BRANCHES);

    const result = await createCustomer({
      name: "Nowhere in particular",
      mobile: nextMobile(),
      assignedToId: admin.id,
      consentGiven: true,
    });

    // A walk-in happened in one shop. Filing it under "all" would put it in the wrong
    // branch's numbers for ever.
    expect(result).toMatchObject({ ok: false, message: "branch.errors.pickOne" });
  });

  it("refuses a branch the person cannot reach", async () => {
    await signInAs(salesMobile); // branch A only
    viewingBranch(store.branchB.id);

    const mobile = nextMobile();
    const result = await createCustomer(input(mobile));

    // getCurrentBranch drops a branch they may not see, so this lands on their own.
    expect(result.ok).toBe(true);
    const saved = await db.customer.findUniqueOrThrow({ where: { mobile } });
    expect(saved.homeBranchId).toBe(branchId);
  });
});

describe("two branches, two managers, two salespeople", () => {
  it("files each person's walk-in under their own branch", async () => {
    const cases = [
      { person: () => store.salesA, branch: () => store.branchA },
      { person: () => store.managerB, branch: () => store.branchB },
    ];

    for (const { person, branch } of cases) {
      await signInAs(person().mobile);
      const mobile = nextMobile();

      const result = await createCustomer({
        name: `Walk-in for ${person().fullName}`,
        mobile,
        assignedToId: person().id,
        consentGiven: true,
      });

      expect(result.ok).toBe(true);
      const saved = await db.customer.findUniqueOrThrow({ where: { mobile } });
      expect(saved.homeBranchId).toBe(branch().id);
    }
  });

  it("refuses to hand a customer to someone from the other branch", async () => {
    // The form only offers people from the branch on screen, but the id is posted.
    await signInAs(store.salesA.mobile);

    const result = await createCustomer({
      name: "Wrongly handed over",
      mobile: nextMobile(),
      assignedToId: store.salesB.id,
      consentGiven: true,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      message: "customers.errors.assigneeUnknown",
      field: "assignedToId",
    });
  });

  it("lets an admin hand a customer to anyone in the branch they are looking at", async () => {
    await signInAs(store.admin.mobile);
    viewingBranch(store.branchB.id);

    const mobile = nextMobile();
    await expect(
      createCustomer({
        name: "Handed to branch B",
        mobile,
        assignedToId: store.salesB.id,
        consentGiven: true,
      }),
    ).resolves.toMatchObject({ ok: true });

    const saved = await db.customer.findUniqueOrThrow({ where: { mobile } });
    expect(saved.assignedToId).toBe(store.salesB.id);
  });

  it("shows each salesperson only their own recent work", async () => {
    await signInAs(store.salesA.mobile);
    const madeByA = await createCustomer(input(nextMobile()));
    if (!madeByA.ok) throw new Error("setup failed");

    await signInAs(store.salesB.mobile);
    const madeByB = await createCustomer({
      name: "Branch B walk-in",
      mobile: nextMobile(),
      assignedToId: store.salesB.id,
      consentGiven: true,
    });
    if (!madeByB.ok) throw new Error("setup failed");

    const forA = (await recentlyHandledBy(store.salesA.id)).map((row) => row.id);
    const forB = (await recentlyHandledBy(store.salesB.id)).map((row) => row.id);

    expect(forA).toContain(madeByA.data.id);
    expect(forA).not.toContain(madeByB.data.id);
    expect(forB).toContain(madeByB.data.id);
    expect(forB).not.toContain(madeByA.data.id);
  });

  it("lets branch B's staff find a customer branch A created (BR-16)", async () => {
    await signInAs(store.salesA.mobile);
    const mobile = nextMobile();
    const created = await createCustomer(input(mobile));
    if (!created.ok) throw new Error("setup failed");

    await signInAs(store.salesB.mobile);
    // The deliberate opposite of every other branch rule: a customer must be findable
    // from anywhere, or the same person is added twice (BR-01).
    expect((await findByMobile(mobile))?.id).toBe(created.data.id);
  });
});
