import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const { AUDIT, writeAudit } = await import("@/lib/audit");
const { loadAuditLog, parseAuditFilters } = await import("@/lib/audit-log");
const { deleteCustomerData } = await import("@/lib/actions/privacy");
const { cancelSale, recordSale } = await import("@/lib/actions/sale");
const { customerProfile, findByMobile } = await import("@/lib/customers");
const { loadOverview } = await import("@/lib/dashboard");
const { REPORTS } = await import("@/lib/reports/definitions");
const { parseFilters, mainTable } = await import("@/lib/reports/core");
const { DELETED_NAME } = await import("@/lib/privacy");
const { accessScope } = await import("@/lib/permissions");
const { isoDate } = await import("@/lib/format");
const { makeStore } = await import("../helpers/store");
const { signInAs } = await import("../helpers/session");
type SessionUser = import("@/lib/auth").SessionUser;
type RunContext = import("@/lib/reports/core").RunContext;

// M16: the audit log screen, the privacy delete and consent. Two branches, two managers,
// two salespeople and an admin, every time.
let store: Awaited<ReturnType<typeof makeStore>>;
const cleanup = { customers: [] as string[], audits: [] as string[] };

const session = (user: { id: string; role: string; homeBranchId: string }): SessionUser =>
  ({ ...user, branchIds: [user.homeBranchId], language: "en" }) as SessionUser;
const mobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const ist = (day: string) => new Date(`${day}T11:00:00.000+05:30`);

beforeAll(async () => {
  store = await makeStore();
});

afterAll(async () => {
  // Test rows only; the app itself never removes audit rows.
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { id: { in: cleanup.audits } },
        { userId: { in: Object.values(store).map((x) => x.id) } },
      ],
    },
  });
  await db.$disconnect();
});

describe("audit log screen", () => {
  // A day of its own, so only these rows are in range.
  const D = "2036-03-10";
  const filters = (extra: Record<string, string> = {}) =>
    parseAuditFilters({ from: D, to: D, ...extra }, isoDate(new Date()));
  const ours = (rows: { id: string }[]) =>
    rows.map((row) => row.id).filter((id) => cleanup.audits.includes(id));
  const rows: Record<string, string> = {};
  let customerMobile = "";
  let billNumber = "";

  beforeAll(async () => {
    customerMobile = mobile();
    const customer = await db.customer.create({
      data: {
        name: "Audit Screen Customer",
        mobile: customerMobile,
        assignedToId: store.salesA.id,
        homeBranchId: store.branchA.id,
      },
    });
    cleanup.customers.push(customer.id);
    const enquiry = await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: store.salesA.id, title: "Wedding" },
    });
    billNumber = `AUD-${randomUUID().slice(0, 6)}`.toUpperCase();
    const sale = await db.sale.create({
      data: {
        branchId: store.branchA.id,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        billNumber,
        billDate: utc(D),
        salespersonId: store.salesA.id,
      },
    });
    const add = async (
      key: string,
      data: {
        userId: string | null;
        branchId: string | null;
        action: string;
        entityType: string;
        entityId: string;
      },
    ) => {
      await writeAudit(db, data);
      const row = await db.auditLog.findFirstOrThrow({
        where: { entityId: data.entityId, action: data.action },
        orderBy: { createdAt: "desc" },
      });
      await db.auditLog.update({ where: { id: row.id }, data: { createdAt: ist(D) } });
      rows[key] = row.id;
      cleanup.audits.push(row.id);
    };
    await add("customerA", {
      userId: store.salesA.id,
      branchId: store.branchA.id,
      action: AUDIT.customerCreate,
      entityType: "Customer",
      entityId: customer.id,
    });
    await add("saleA", {
      userId: store.managerA.id,
      branchId: store.branchA.id,
      action: AUDIT.saleCancel,
      entityType: "Sale",
      entityId: sale.id,
    });
    await add("userB", {
      userId: store.managerB.id,
      branchId: store.branchB.id,
      action: AUDIT.userUpdate,
      entityType: "User",
      entityId: store.salesB.id,
    });
    await add("storeWide", {
      userId: store.admin.id,
      branchId: null,
      action: AUDIT.settingUpdate,
      entityType: "Setting",
      entityId: "reminderTimes",
    });
    // Manager A editing a customer whose home is branch B.
    await add("managerAInB", {
      userId: store.managerA.id,
      branchId: store.branchB.id,
      action: AUDIT.customerUpdate,
      entityType: "Customer",
      entityId: `other-${randomUUID()}`,
    });
  });

  it("a manager reads their branch, and what they did themselves", async () => {
    const managerA = session(store.managerA);
    const a = await loadAuditLog(managerA, accessScope(managerA), filters());
    expect(ours(a.rows).sort()).toEqual([rows.customerA, rows.saleA, rows.managerAInB].sort());

    const managerB = session(store.managerB);
    const b = await loadAuditLog(managerB, accessScope(managerB), filters());
    // Branch B's rows, including manager A's edit filed there; nothing of branch A.
    expect(ours(b.rows).sort()).toEqual([rows.userB, rows.managerAInB].sort());
  });

  it("the admin reads everything on All branches, one branch when one is chosen", async () => {
    const admin = session(store.admin);
    const all = await loadAuditLog(admin, { all: true as const }, filters());
    expect(ours(all.rows)).toHaveLength(5);
    const onlyB = await loadAuditLog(
      admin,
      { all: false, branchIds: [store.branchB.id] },
      filters(),
    );
    expect(ours(onlyB.rows).sort()).toEqual([rows.userB, rows.managerAInB].sort());
  });

  it("filters by action, record type and user", async () => {
    const admin = session(store.admin);
    const all = { all: true as const };
    const kind = await loadAuditLog(admin, all, filters({ kind: "CANCEL" }));
    expect(ours(kind.rows)).toEqual([rows.saleA]);
    const entity = await loadAuditLog(admin, all, filters({ entity: "Setting" }));
    expect(ours(entity.rows)).toEqual([rows.storeWide]);
    const user = await loadAuditLog(admin, all, filters({ user: store.managerA.id }));
    expect(ours(user.rows).sort()).toEqual([rows.saleA, rows.managerAInB].sort());
  });

  it("finds a customer's rows by mobile and a sale's by bill number", async () => {
    const admin = session(store.admin);
    const all = { all: true as const };
    const byMobile = await loadAuditLog(admin, all, filters({ q: customerMobile }));
    expect(ours(byMobile.rows).sort()).toEqual([rows.customerA, rows.saleA].sort());
    const byBill = await loadAuditLog(admin, all, filters({ q: billNumber.toLowerCase() }));
    expect(ours(byBill.rows)).toEqual([rows.saleA]);
    // The row names the customer and links to them.
    const sale = byBill.rows.find((row) => row.id === rows.saleA)!;
    expect(sale).toMatchObject({ customerName: "Audit Screen Customer", kind: "CANCEL" });
    expect(sale.href).toMatch(/^\/customers\//);
    const nothing = await loadAuditLog(admin, all, filters({ q: "9000000000" }));
    expect(ours(nothing.rows)).toEqual([]);
  });
});

describe("sales are audited when recorded and cancelled (M16.01)", () => {
  it("writes sale:create and sale:cancel with old and new values", async () => {
    const customer = await db.customer.create({
      data: {
        name: "Audited Sale",
        mobile: mobile(),
        assignedToId: store.salesA.id,
        homeBranchId: store.branchA.id,
      },
    });
    cleanup.customers.push(customer.id);
    await db.enquiry.create({
      data: { customerId: customer.id, assignedToId: store.salesA.id, title: "Saree" },
    });
    await signInAs(store.salesA.mobile);
    const saved = await recordSale({
      clientId: randomUUID(),
      customerId: customer.id,
      sale: {
        billNumber: `AS-${randomUUID().slice(0, 6)}`,
        billDate: isoDate(new Date()),
        billAmount: 1800,
      },
    });
    expect(saved.ok).toBe(true);
    const sale = await db.sale.findFirstOrThrow({ where: { customerId: customer.id } });
    await signInAs(store.managerA.mobile);
    expect(await cancelSale({ id: sale.id, reason: "Returned" })).toMatchObject({ ok: true });

    const audits = await db.auditLog.findMany({
      where: { entityId: sale.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((row) => row.action)).toEqual([AUDIT.saleCreate, AUDIT.saleCancel]);
    expect(audits[1]).toMatchObject({ userId: store.managerA.id, device: "vitest" });
  });
});

describe("privacy delete (M16.03)", () => {
  // A day of its own for the report totals.
  const D = "2036-04-15";
  let customerId = "";
  let theMobile = "";
  let importId = "";
  const ctx = (): RunContext => ({
    scope: { all: false, branchIds: [store.branchA.id] },
    range: { from: D, to: D },
    today: isoDate(new Date()),
    filters: parseFilters({}),
    self: null,
    locale: "en",
  });
  const totals = async () => {
    const overview = await loadOverview(ctx().scope, ctx().range, ctx().today, "en");
    const r5 = mainTable(await REPORTS.r5.run(ctx()))!;
    const r1 = mainTable(await REPORTS.r1.run(ctx()))!;
    return {
      visited: overview.visited,
      sales: overview.sales,
      conversion: overview.conversionPercent,
      r5: r5.totals,
      r1Rows: r1.rows.length,
    };
  };

  beforeAll(async () => {
    theMobile = mobile();
    const customer = await db.customer.create({
      data: {
        name: "Priya Privacy",
        mobile: theMobile,
        altMobile: mobile(),
        area: "Adajan",
        city: "Surat",
        address: "12 Temple Road",
        occasion: "Daughter's wedding",
        occasionDate: utc("2036-12-01"),
        assignedToId: store.salesA.id,
        homeBranchId: store.branchA.id,
        consentGiven: true,
        consentAt: new Date(),
        consentById: store.salesA.id,
      },
    });
    customerId = customer.id;
    cleanup.customers.push(customer.id);
    const enquiry = await db.enquiry.create({
      data: {
        customerId,
        assignedToId: store.salesA.id,
        title: "Lehenga",
        latestRemarks: "Wants red, budget 40k",
      },
    });
    const base = { branchId: store.branchA.id, customerId, enquiryId: enquiry.id };
    await db.visit.create({
      data: {
        ...base,
        clientId: randomUUID(),
        visitAt: ist(D),
        salespersonId: store.salesA.id,
        outcome: "PURCHASED",
        visitType: "NEW",
        remarks: "Came with her mother",
      },
    });
    const sale = await db.sale.create({
      data: {
        ...base,
        clientId: randomUUID(),
        billNumber: `PRV-${randomUUID().slice(0, 6)}`,
        billDate: utc(D),
        billAmount: 40000,
        salespersonId: store.salesA.id,
        fromFollowUp: true,
        remarks: "Paid by her card",
      },
    });
    await db.followUp.create({
      data: {
        ...base,
        clientId: randomUUID(),
        dueDate: utc("2036-04-20"),
        timeSlot: "EVENING",
        method: "CALL",
        assignedToId: store.salesA.id,
        createdFrom: "VISIT",
        reason: "Alteration fitting",
      },
    });
    await db.timelineEvent.create({
      data: {
        customerId,
        type: "visit.recorded",
        title: "timeline.visit",
        detail: "Came with her mother",
        staffId: store.salesA.id,
        branchId: store.branchA.id,
      },
    });
    // What the customer's own actions wrote to the log.
    await writeAudit(db, {
      userId: store.salesA.id,
      branchId: store.branchA.id,
      action: AUDIT.customerCreate,
      entityType: "Customer",
      entityId: customerId,
      newValue: { name: "Priya Privacy", mobile: theMobile, area: "Adajan", source: "WALK_IN" },
    });
    await writeAudit(db, {
      userId: store.salesA.id,
      branchId: store.branchA.id,
      action: AUDIT.saleCreate,
      entityType: "Sale",
      entityId: sale.id,
      newValue: { billNumber: sale.billNumber, remarks: "Paid by her card", billAmount: "40000" },
    });
    // M24's copy of who she is.
    importId = (
      await db.importJob.create({
        data: {
          branchId: store.branchA.id,
          fileName: "old-list.xlsx",
          uploadedById: store.managerA.id,
          outcomes: [
            { line: 2, name: "Priya Privacy", mobile: theMobile, result: "imported", reasons: [] },
            { line: 3, name: "Someone Else", mobile: "9999999999", result: "skipped", reasons: [] },
          ],
        },
      })
    ).id;
  });

  it("shows the consent with its date and who recorded it (M16.02)", async () => {
    const profile = await customerProfile(customerId);
    expect(profile?.consent).toMatchObject({ given: true, byName: store.salesA.fullName });
    expect(profile?.consent.at).toBeInstanceOf(Date);
  });

  it("is the admin's alone", async () => {
    for (const person of [store.salesA, store.managerA]) {
      await signInAs(person.mobile);
      expect(await deleteCustomerData({ customerId, lastFour: theMobile.slice(-4) })).toMatchObject(
        { ok: false, code: "FORBIDDEN" },
      );
    }
  });

  it("needs the last four digits of the mobile", async () => {
    await signInAs(store.admin.mobile);
    const wrong = theMobile.slice(-4) === "0000" ? "1111" : "0000";
    expect(await deleteCustomerData({ customerId, lastFour: wrong })).toMatchObject({
      ok: false,
      code: "RULE",
      message: "privacy.errors.lastFourWrong",
      field: "lastFour",
    });
    expect(await deleteCustomerData({ customerId, lastFour: "12" })).toMatchObject({
      ok: false,
      field: "lastFour",
    });
    expect((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).mobile).toBe(
      theMobile,
    );
  });

  it("removes the personal details, keeps every report total, and logs who did it", async () => {
    const before = await totals();
    await signInAs(store.admin.mobile);
    expect(await deleteCustomerData({ customerId, lastFour: theMobile.slice(-4) })).toMatchObject({
      ok: true,
      data: { followUpsCancelled: 1 },
    });

    const row = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(row).toMatchObject({
      name: DELETED_NAME,
      mobile: null,
      altMobile: null,
      area: null,
      city: null,
      address: null,
      occasion: null,
      occasionDate: null,
      active: false,
    });
    expect(row.anonymizedAt).toBeInstanceOf(Date);

    // Done when: no longer found by mobile — not in search, not on the audit screen.
    expect(await findByMobile(theMobile)).toBeNull();
    expect(await customerProfile(customerId)).toBeNull();

    // Remarks gone; the pending follow-up cancelled.
    expect((await db.visit.findFirstOrThrow({ where: { customerId } })).remarks).toBeNull();
    expect((await db.sale.findFirstOrThrow({ where: { customerId } })).remarks).toBeNull();
    expect((await db.enquiry.findFirstOrThrow({ where: { customerId } })).latestRemarks).toBeNull();
    expect((await db.timelineEvent.findFirstOrThrow({ where: { customerId } })).detail).toBeNull();
    const followUp = await db.followUp.findFirstOrThrow({ where: { customerId } });
    expect(followUp).toMatchObject({ status: "CANCELLED", reason: null });

    // The old audit rows keep what happened, without who the customer was.
    const sale = await db.sale.findFirstOrThrow({ where: { customerId } });
    const logged = await db.auditLog.findMany({
      where: { entityId: { in: [customerId, sale.id] } },
    });
    const text = JSON.stringify(logged);
    for (const secret of [theMobile, "Priya", "Adajan", "Paid by her card", "Temple"])
      expect(text).not.toContain(secret);
    expect(text).toContain(sale.billNumber);
    const erased = logged.find((r) => r.action === AUDIT.customerAnonymize)!;
    expect(erased).toMatchObject({ userId: store.admin.id, device: "vitest" });

    // Done when: report totals unchanged.
    const after = await totals();
    expect(after).toEqual(before);
    const r1 = mainTable(await REPORTS.r1.run(ctx()))!;
    const theirs = r1.rows.find((r) => r.cells.customer === DELETED_NAME)!;
    expect(theirs.cells.mobile).toBeNull();
    expect(theirs.href).toBeUndefined(); // no profile to open any more

    // Nor in an old import file (M24); other people untouched.
    const copies = JSON.stringify([
      await db.importJob.findUniqueOrThrow({ where: { id: importId } }),
    ]);
    for (const secret of [theMobile, "Priya", "Adajan", "lehenga"])
      expect(copies).not.toContain(secret);
    expect(copies).toContain("Someone Else");
    await db.importJob.delete({ where: { id: importId } });
  });

  it("happens once", async () => {
    await signInAs(store.admin.mobile);
    expect(await deleteCustomerData({ customerId, lastFour: theMobile.slice(-4) })).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
