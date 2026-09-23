import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createItem, deleteItem, renameItem, reorderItems, setItemActive } =
  await import("@/app/(admin)/settings/master-lists/actions");
const { activeCategories, activeLostReasons } = await import("@/lib/master-lists");
const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { makeBranch, makeCustomer, makeEnquiry, makeUser, nextMobile } =
  await import("../helpers/branch-access");
const { signInAs } = await import("../helpers/session");

const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 8)}`;

function names(nameEn: string) {
  return { nameEn, nameHi: `${nameEn} हिन्दी`, nameGu: `${nameEn} ગુજરાતી` };
}

let branchId: string;
let adminMobile: string;

beforeEach(async () => {
  branchId = (await makeBranch()).id;
  adminMobile = nextMobile();
  await makeUser({ role: "ADMIN", homeBranchId: branchId, mobile: adminMobile });
  await signInAs(adminMobile);
});

afterAll(() => db.$disconnect());

describe("createItem", () => {
  it("adds a store-wide category at the end of the list", async () => {
    const nameEn = unique("Lehenga");
    const result = await createItem({ kind: "category", ...names(nameEn), branchId: "all" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = await db.requirementCategory.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(saved.branchId).toBeNull(); // "all" means every branch (SOW M17.07)
    expect(saved.active).toBe(true);
    const highest = await db.requirementCategory.findFirst({ orderBy: { sortOrder: "desc" } });
    expect(saved.sortOrder).toBe(highest?.sortOrder);
    expect(
      await db.auditLog.count({ where: { entityId: saved.id, action: AUDIT.categoryCreate } }),
    ).toBe(1);
  });

  it("adds a reason, which has no branch of its own", async () => {
    const result = await createItem({ kind: "reason", ...names(unique("Too far")) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = await db.lostReason.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(saved.active).toBe(true);
  });

  it("refuses the same name twice in one list, and says which", async () => {
    const nameEn = unique("Sherwani");
    await createItem({ kind: "category", ...names(nameEn), branchId: "all" });

    const again = await createItem({ kind: "category", ...names(nameEn), branchId: "all" });

    expect(again).toMatchObject({
      ok: false,
      message: "masterLists.errors.nameTaken",
      field: "nameEn",
      values: { name: nameEn },
    });
  });

  it("refuses a branch item that clashes with a store-wide one", async () => {
    const nameEn = unique("Saree");
    await createItem({ kind: "category", ...names(nameEn), branchId: "all" });

    // Both would appear in the same chip row for this branch, so it is still a clash.
    const clash = await createItem({ kind: "category", ...names(nameEn), branchId });

    expect(clash).toMatchObject({ ok: false, message: "masterLists.errors.nameTaken" });
  });

  it("allows the same name in a different list", async () => {
    const nameEn = unique("Other");
    await createItem({ kind: "category", ...names(nameEn), branchId: "all" });

    await expect(createItem({ kind: "reason", ...names(nameEn) })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses a manager", async () => {
    const managerMobile = nextMobile();
    await makeUser({ role: "MANAGER", homeBranchId: branchId, mobile: managerMobile });
    await signInAs(managerMobile);

    await expect(
      createItem({ kind: "category", ...names(unique("Nope")), branchId: "all" }),
    ).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("renameItem", () => {
  it("renames in all three languages and keeps both versions in the audit row", async () => {
    const created = await createItem({
      kind: "category",
      ...names(unique("Old")),
      branchId: "all",
    });
    if (!created.ok) throw new Error("setup failed");
    const nameEn = unique("New");

    const result = await renameItem({
      kind: "category",
      id: created.data.id,
      ...names(nameEn),
      branchId: "all",
    });

    expect(result.ok).toBe(true);
    const saved = await db.requirementCategory.findUniqueOrThrow({
      where: { id: created.data.id },
    });
    expect(saved.nameEn).toBe(nameEn);
    expect(saved.nameGu).toBe(`${nameEn} ગુજરાતી`);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: created.data.id, action: AUDIT.categoryUpdate },
    });
    expect(audit.newValue).toMatchObject({ nameEn });
  });

  it("does not trip over its own name", async () => {
    const nameEn = unique("Same");
    const created = await createItem({ kind: "category", ...names(nameEn), branchId: "all" });
    if (!created.ok) throw new Error("setup failed");

    await expect(
      renameItem({ kind: "category", id: created.data.id, ...names(nameEn), branchId: "all" }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("setItemActive", () => {
  it("takes a deactivated item out of what the app offers, without touching old records", async () => {
    const created = await createItem({
      kind: "category",
      ...names(unique("Seasonal")),
      branchId: "all",
    });
    if (!created.ok) throw new Error("setup failed");

    const before = await activeCategories({ all: false, branchIds: [branchId] }, "en");
    expect(before.some((item) => item.id === created.data.id)).toBe(true);

    await setItemActive({ kind: "category", id: created.data.id, active: false });

    const after = await activeCategories({ all: false, branchIds: [branchId] }, "en");
    expect(after.some((item) => item.id === created.data.id)).toBe(false);
    // The row is still there — deactivated, not deleted.
    expect(
      (await db.requirementCategory.findUniqueOrThrow({ where: { id: created.data.id } })).active,
    ).toBe(false);
  });

  it("does the same for reasons", async () => {
    const created = await createItem({ kind: "reason", ...names(unique("Closed")) });
    if (!created.ok) throw new Error("setup failed");

    await setItemActive({ kind: "reason", id: created.data.id, active: false });

    const active = await activeLostReasons("en");
    expect(active.some((item) => item.id === created.data.id)).toBe(false);
  });
});

describe("reorderItems", () => {
  it("renumbers the whole list 1..n in the order it was given", async () => {
    const ids: string[] = [];
    for (const name of ["First", "Second", "Third"]) {
      const created = await createItem({ kind: "reason", ...names(unique(name)) });
      if (!created.ok) throw new Error("setup failed");
      ids.push(created.data.id);
    }

    const moved = [ids[2]!, ids[0]!, ids[1]!];
    const result = await reorderItems({ kind: "reason", ids: moved });

    expect(result).toMatchObject({ ok: true, data: { count: 3 } });
    const rows = await db.lostReason.findMany({
      where: { id: { in: ids } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, sortOrder: true },
    });
    expect(rows.map((row) => row.id)).toEqual(moved);
    expect(rows.map((row) => row.sortOrder)).toEqual([1, 2, 3]);
  });
});

describe("deleteItem", () => {
  it("removes an item nothing points at, and records what went", async () => {
    const nameEn = unique("Typo");
    const created = await createItem({ kind: "category", ...names(nameEn), branchId: "all" });
    if (!created.ok) throw new Error("setup failed");

    const result = await deleteItem({ kind: "category", id: created.data.id });

    expect(result.ok).toBe(true);
    expect(await db.requirementCategory.findUnique({ where: { id: created.data.id } })).toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: created.data.id, action: AUDIT.categoryDelete },
    });
    // The audit row is the only place this item still exists.
    expect(audit.oldValue).toMatchObject({ nameEn });
  });

  it("refuses to delete one a record points at, and says how many", async () => {
    const created = await createItem({
      kind: "category",
      ...names(unique("Used")),
      branchId: "all",
    });
    if (!created.ok) throw new Error("setup failed");

    const salesperson = await makeUser({ role: "SALESPERSON", homeBranchId: branchId });
    const customer = await makeCustomer(branchId, salesperson.id);
    const enquiry = await makeEnquiry(customer.id, salesperson.id);
    await db.enquiryCategory.create({
      data: { enquiryId: enquiry.id, categoryId: created.data.id },
    });

    const result = await deleteItem({ kind: "category", id: created.data.id });

    expect(result).toMatchObject({
      ok: false,
      message: "masterLists.errors.inUse",
      values: { count: 1 },
    });
    expect(
      await db.requirementCategory.findUnique({ where: { id: created.data.id } }),
    ).not.toBeNull();
  });
});

describe("branch scope", () => {
  it("hides another branch's category, and refuses to touch it", async () => {
    const otherBranch = await makeBranch();
    const otherAdminMobile = nextMobile();
    await makeUser({ role: "ADMIN", homeBranchId: otherBranch.id, mobile: otherAdminMobile });
    await signInAs(otherAdminMobile);

    const created = await createItem({
      kind: "category",
      ...names(unique("Branch only")),
      branchId: otherBranch.id,
    });
    if (!created.ok) throw new Error("setup failed");

    // Back to the first admin, whose scope is their own branch.
    await signInAs(adminMobile);

    const visible = await activeCategories({ all: false, branchIds: [branchId] }, "en");
    expect(visible.some((item) => item.id === created.data.id)).toBe(false);

    await expect(
      setItemActive({ kind: "category", id: created.data.id, active: false }),
    ).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("shows a store-wide item to every branch", async () => {
    const created = await createItem({
      kind: "category",
      ...names(unique("Shared")),
      branchId: "all",
    });
    if (!created.ok) throw new Error("setup failed");

    const otherBranch = await makeBranch();
    const visible = await activeCategories({ all: false, branchIds: [otherBranch.id] }, "en");
    expect(visible.some((item) => item.id === created.data.id)).toBe(true);
  });
});

describe("activeCategories", () => {
  it("reads the name in the asked-for language, in the admin's order", async () => {
    const nameEn = unique("Kurta");
    const created = await createItem({ kind: "category", ...names(nameEn), branchId: "all" });
    if (!created.ok) throw new Error("setup failed");

    const gujarati = await activeCategories({ all: true }, "gu");
    const item = gujarati.find((row) => row.id === created.data.id);
    expect(item?.name).toBe(`${nameEn} ગુજરાતી`);

    const sortOrders = gujarati.map((row) => row.sortOrder);
    expect([...sortOrders].sort((a, b) => a - b)).toEqual(sortOrders);
  });
});
