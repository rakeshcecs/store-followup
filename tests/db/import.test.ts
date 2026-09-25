import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const { AUDIT } = await import("@/lib/audit");
const { TIMELINE } = await import("@/lib/timeline");
const { prepareImport } = await import("@/lib/import/prepare");
const { runImport } = await import("@/lib/import/run");
const { cancelImport, startImport } = await import("@/lib/actions/import");
const { handleCustomerImport } = await import("../../worker/jobs/customer-import");
const { IMPORT_CHUNK } = await import("@/lib/import/types");
const { nextMobile, makeCustomer } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs } = await import("../helpers/session");
type ImportRow = import("@/lib/import/types").ImportRow;
type Outcome = import("@/lib/import/types").Outcome;

// M24: preview, confirm, the worker's run, updates, re-imports and permissions. Two
// branches, two managers, two salespeople and an admin, every time.
let store: Awaited<ReturnType<typeof makeStore>>;
let department: { id: string; name: string };

const HEAD =
  "Name*,Mobile*,Alternate mobile,Area,City,Department,Occasion,Occasion date (DD-MM-YYYY),Assigned salesperson mobile";
const csv = (...lines: string[]) =>
  new TextEncoder().encode([HEAD, ...lines].join("\n")).buffer as ArrayBuffer;

async function upload(
  bytes: ArrayBuffer,
  who: { id: string } = store.managerA,
  branchId = store.branchA.id,
) {
  const result = await prepareImport({
    bytes,
    fileName: "customers.csv",
    branchId,
    uploaderId: who.id,
  });
  if (!result.ok) throw new Error(result.error);
  return db.importJob.findUniqueOrThrow({ where: { id: result.jobId } });
}

async function confirm(jobId: string, options: { updateExisting?: boolean } = {}) {
  await signInAs(store.managerA.mobile);
  const result = await startImport({ jobId, ...options });
  expect(result).toMatchObject({ ok: true });
  expect(await runImport(jobId)).toBe(true);
  return db.importJob.findUniqueOrThrow({ where: { id: jobId } });
}

beforeAll(async () => {
  store = await makeStore();
  department = await db.department.create({
    data: { name: `Imp Dept ${randomUUID().slice(0, 6)}` },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("preview (M24.02)", () => {
  it("sorts every row into Ready, Has mistakes and Already exists", async () => {
    const existingB = await makeCustomer(store.branchB.id, store.salesB.id); // another branch: still a duplicate (BR-16)
    const [a, b, c] = [nextMobile(), nextMobile(), nextMobile()];
    const job = await upload(
      csv(
        `Asha,${a},,Adajan,Surat,${department.name},Wedding,05-12-2026,${store.salesA.mobile}`,
        `Bhavesh,12345,,,,,,,`,
        `Chetan,${existingB.mobile},,,,,,,`,
        `Deepa,${b},,,,,,,${store.salesB.mobile}`, // salesperson of the other branch: unknown here
        `Asha again,${a},,,,,,,`,
        `Ek,${c},,,,,,31-02-2026,`,
      ),
    );
    expect(job).toMatchObject({
      status: "PENDING",
      totalRows: 6,
      readyRows: 2,
      errorRows: 3,
      existingRows: 1,
      branchId: store.branchA.id,
      uploadedById: store.managerA.id,
    });
    const rows = job.rows as unknown as ImportRow[];
    expect(rows.map((r) => [r.line, r.state])).toEqual([
      [2, "ready"],
      [3, "error"],
      [4, "exists"],
      [5, "ready"],
      [6, "error"],
      [7, "error"],
    ]);
    expect(rows[0]).toMatchObject({
      assignedToId: store.salesA.id,
      departmentId: department.id,
    });
    expect(rows[3]).toMatchObject({ assignedToId: store.managerA.id });
    expect(rows[3]!.notes[0]!.key).toBe("import.notes.salespersonUnknown");
    expect(rows[4]!.errors[0]).toEqual({
      key: "import.rowErrors.duplicateInFile",
      values: { line: 2 },
    });
    // Nothing saved yet.
    expect(await db.customer.count({ where: { mobile: a } })).toBe(0);
  });

  it("refuses more than 20,000 rows", async () => {
    const lines = Array.from({ length: 20_001 }, (_, i) => `N${i},${9_000_000_000 + i}`);
    const result = await prepareImport({
      bytes: csv(...lines),
      fileName: "big.csv",
      branchId: store.branchA.id,
      uploaderId: store.managerA.id,
    });
    expect(result).toEqual({ ok: false, error: "import.errors.tooMany" });
  });
});

describe("the run (worker)", () => {
  it("imports the ready rows as IMPORT customers of the branch, with a timeline entry and audit", async () => {
    const [a, b] = [nextMobile(), nextMobile()];
    const job = await upload(
      csv(
        `Asha Run,${a},,Adajan,Surat,${department.name},Wedding,05-12-2026,${store.salesA.mobile}`,
        `Bhavesh Run,${b},,,,,,,9899999999`,
        `Bad Row,12,,,,,,,`,
      ),
    );
    const done = await confirm(job.id);
    expect(done).toMatchObject({
      status: "DONE",
      imported: 2,
      updated: 0,
      skipped: 0,
      errorRows: 1,
      processed: 2,
    });
    expect(done.resultFileUrl).toBe(`/import/${job.id}/result`);

    const asha = await db.customer.findUniqueOrThrow({ where: { mobile: a } });
    expect(asha).toMatchObject({
      name: "Asha Run",
      area: "Adajan",
      city: "Surat",
      departmentId: department.id,
      occasion: "Wedding",
      assignedToId: store.salesA.id,
      homeBranchId: store.branchA.id,
      source: "IMPORT",
      consentGiven: false,
      createdById: store.managerA.id,
    });
    expect(asha.occasionDate?.toISOString().slice(0, 10)).toBe("2026-12-05");
    const bhavesh = await db.customer.findUniqueOrThrow({ where: { mobile: b } });
    expect(bhavesh).toMatchObject({ assignedToId: store.managerA.id });

    // M24.04: "Imported on [date] by [name]".
    const event = await db.timelineEvent.findFirstOrThrow({ where: { customerId: asha.id } });
    expect(event).toMatchObject({
      ...TIMELINE.imported,
      staffId: store.managerA.id,
      branchId: store.branchA.id,
      entityId: job.id,
    });

    // The result file's rows: the mistake, and the unknown salesperson's note.
    const outcomes = done.outcomes as unknown as Outcome[];
    expect(
      outcomes.map((o) => [o.line, o.result, o.reasons.map((r) => r.key.split(".").at(-1))]),
    ).toEqual([
      [4, "skipped", ["mobileInvalid"]],
      [3, "imported", ["salespersonUnknown"]],
    ]);

    const audits = await db.auditLog.findMany({
      where: { entityId: job.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((r) => r.action)).toEqual([AUDIT.importCreate, AUDIT.importDone]);
    expect(audits[1]!.newValue).toMatchObject({ imported: 2, mistakes: 1 });
  });

  it("re-importing the same file creates no duplicates (Done when)", async () => {
    const lines = [nextMobile(), nextMobile(), nextMobile()].map(
      (m, i) => `Again ${i},${m},,,,,,,`,
    );
    const first = await confirm((await upload(csv(...lines))).id);
    expect(first.imported).toBe(3);
    const second = await upload(csv(...lines));
    expect(second).toMatchObject({ readyRows: 0, existingRows: 3 });
    await signInAs(store.managerA.mobile);
    // Skip: nothing to import at all.
    expect(await startImport({ jobId: second.id })).toMatchObject({
      ok: false,
      message: "import.errors.nothingToImport",
    });
    const mobiles = lines.map((l) => l.split(",")[1]!);
    expect(await db.customer.count({ where: { mobile: { in: mobiles } } })).toBe(3);
  });

  it("'Update empty fields only' fills blanks and changes nothing that is set", async () => {
    const mobile = nextMobile();
    const customer = await db.customer.create({
      data: {
        name: "Kept Name",
        mobile,
        area: "Kept Area",
        assignedToId: store.salesB.id,
        homeBranchId: store.branchB.id,
      },
    });
    const alt = nextMobile();
    const job = await upload(
      csv(
        `New Name,${mobile},${alt},New Area,Surat,${department.name},Engagement,01-02-2027,${store.salesA.mobile}`,
      ),
    );
    const done = await confirm(job.id, { updateExisting: true });
    expect(done).toMatchObject({ imported: 0, updated: 1, skipped: 0 });
    const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after).toMatchObject({
      name: "Kept Name", // never overwritten
      area: "Kept Area",
      assignedToId: store.salesB.id,
      homeBranchId: store.branchB.id,
      altMobile: alt,
      city: "Surat",
      departmentId: department.id,
      occasion: "Engagement",
      updatedById: store.managerA.id,
    });
    const event = await db.timelineEvent.findFirstOrThrow({ where: { customerId: customer.id } });
    expect(event.type).toBe(TIMELINE.importUpdated.type);

    // Again: nothing left to fill, so it is skipped with that reason.
    const again = await confirm((await upload(csv(`New Name,${mobile},,,Surat,,,,`))).id, {
      updateExisting: true,
    });
    expect(again).toMatchObject({ updated: 0, skipped: 1 });
    expect((again.outcomes as unknown as Outcome[])[0]!.reasons[0]!.key).toBe(
      "import.reasons.nothingToAdd",
    );
  });

  it("'Skip' leaves existing customers alone", async () => {
    const existing = await makeCustomer(store.branchA.id, store.salesA.id);
    const fresh = nextMobile();
    const done = await confirm(
      (await upload(csv(`X,${existing.mobile},,Area,,,,,`, `Y,${fresh},,,,,,,`))).id,
    );
    expect(done).toMatchObject({ imported: 1, skipped: 1 });
    expect((await db.customer.findUniqueOrThrow({ where: { id: existing.id } })).area).toBeNull();
  });

  it("a number saved between the preview and the run is skipped, never doubled", async () => {
    const mobile = nextMobile();
    const job = await upload(csv(`Race,${mobile},,,,,,,`));
    await makeCustomer(store.branchB.id, store.salesB.id, mobile); // someone saves it meanwhile
    const done = await confirm(job.id);
    expect(done).toMatchObject({ imported: 0, skipped: 1 });
    expect(await db.customer.count({ where: { mobile } })).toBe(1);
  });

  it("resumes after a crash at the next chunk, and a second run does nothing", async () => {
    const mobiles = Array.from({ length: IMPORT_CHUNK + 20 }, () => nextMobile());
    const job = await upload(csv(...mobiles.map((m, i) => `Chunk ${i},${m},,,,,,,`)));
    await signInAs(store.managerA.mobile);
    await startImport({ jobId: job.id });
    // Pretend the first chunk finished and the worker died.
    let calls = 0;
    const original = db.$transaction.bind(db);
    const spy = vi.spyOn(db, "$transaction").mockImplementation(((
      ...args: Parameters<typeof db.$transaction>
    ) => {
      calls += 1;
      if (calls === 2) throw new Error("worker died");
      return original(...args);
    }) as typeof db.$transaction);
    await expect(runImport(job.id)).rejects.toThrow("worker died");
    spy.mockRestore();
    const half = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(half).toMatchObject({
      status: "PROCESSING",
      processed: IMPORT_CHUNK,
      imported: IMPORT_CHUNK,
    });

    expect(await runImport(job.id)).toBe(true);
    const done = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({
      status: "DONE",
      processed: mobiles.length,
      imported: mobiles.length,
      skipped: 0,
    });
    expect(await db.customer.count({ where: { mobile: { in: mobiles } } })).toBe(mobiles.length);
    expect(await runImport(job.id)).toBe(false); // already done
  });

  it("the worker marks the import failed on its last try", async () => {
    const job = await upload(csv(`Fail,${nextMobile()},,,,,,,`));
    await signInAs(store.managerA.mobile);
    await startImport({ jobId: job.id });
    const spy = vi.spyOn(db, "$transaction").mockRejectedValue(new Error("disk full"));
    const fake = { payload: { importJobId: job.id }, attempts: 3, maxAttempts: 3 } as never;
    await expect(handleCustomerImport(fake)).rejects.toThrow("disk full");
    spy.mockRestore();
    expect(await db.importJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      error: "disk full",
    });
  });
});

describe("confirm and discard", () => {
  it("queues one worker job, and a second press is refused", async () => {
    const job = await upload(csv(`Queue,${nextMobile()},,,,,,,`));
    await signInAs(store.managerA.mobile);
    expect(await startImport({ jobId: job.id })).toMatchObject({ ok: true });
    expect(await db.job.count({ where: { singletonKey: `customer-import:${job.id}` } })).toBe(1);
    expect(await startImport({ jobId: job.id })).toMatchObject({
      ok: false,
      message: "import.errors.notPending",
    });
  });

  it("discarding keeps nothing of the file and is audited", async () => {
    const mobile = nextMobile();
    const job = await upload(csv(`Discard,${mobile},,,,,,,`));
    await signInAs(store.managerA.mobile);
    expect(await cancelImport({ jobId: job.id })).toMatchObject({ ok: true });
    const after = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: "CANCELLED", rows: null });
    expect(await db.customer.count({ where: { mobile } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { entityId: job.id, action: AUDIT.importCancel } }),
    ).toBe(1);
  });

  it("salespeople cannot, and a manager only for their own branches", async () => {
    const job = await upload(csv(`Perm,${nextMobile()},,,,,,,`));
    await signInAs(store.salesA.mobile);
    expect(await startImport({ jobId: job.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await signInAs(store.managerB.mobile);
    expect(await startImport({ jobId: job.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await cancelImport({ jobId: job.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    // The admin may, for any branch.
    await signInAs(store.admin.mobile);
    expect(await startImport({ jobId: job.id })).toMatchObject({ ok: true });
  });
});
