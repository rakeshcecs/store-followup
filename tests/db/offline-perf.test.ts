import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { POST } = await import("@/app/api/sync/route");
const { GET } = await import("@/app/api/sync/cache/route");
const { db } = await import("@/lib/db");
const { isoDate } = await import("@/lib/format");
const { addDays } = await import("@/lib/follow-up-dates");
const { nextMobile } = await import("../helpers/branch-access");
const { makeStore } = await import("../helpers/store");
const { signInAs } = await import("../helpers/session");
import type { OfflineCache } from "@/lib/offline/types";

// M19 at shop size: a full outbox batch (50 entries) after a day offline, and the
// offline copy of a salesperson with 2,000 customers. Targets: the batch in under 10 s
// (a phone on mobile data waits for it), the copy in under 3 s.
const CUSTOMERS = 2000;
let store: Awaited<ReturnType<typeof makeStore>>;
let sherwani: string;

beforeAll(async () => {
  store = await makeStore();
  sherwani = (
    await db.requirementCategory.create({
      data: { nameEn: "Sherwani", nameHi: "Sherwani", nameGu: "Sherwani", sortOrder: 1 },
    })
  ).id;
  await db.customer.createMany({
    data: Array.from({ length: CUSTOMERS }, (_, index) => ({
      name: `Perf Customer ${index}`,
      mobile: nextMobile(),
      assignedToId: store.salesA.id,
      homeBranchId: store.branchA.id,
    })),
    skipDuplicates: true,
  });
  await signInAs(store.salesA.mobile);
}, 120_000);

afterAll(() => db.$disconnect());

describe("offline sync at shop size", () => {
  it("50 new customers with their visits and follow-ups sync in under 10 s", async () => {
    const today = isoDate(new Date());
    const entries = Array.from({ length: 25 }, () => {
      const customerId = randomUUID();
      const visitId = randomUUID();
      return [
        {
          id: customerId,
          kind: "customer",
          at: new Date().toISOString(),
          branchId: store.branchA.id,
          input: {
            name: "Perf Offline",
            mobile: nextMobile(),
            assignedToId: store.salesA.id,
            consentGiven: true,
          },
        },
        {
          id: visitId,
          kind: "visit",
          at: new Date().toISOString(),
          branchId: store.branchA.id,
          input: {
            customerId,
            categoryIds: [sherwani],
            outcome: "DECIDE_LATER",
            followUp: {
              clientId: randomUUID(),
              dueDate: addDays(today, 1),
              timeSlot: "EVENING",
              method: "CALL",
            },
          },
          seenPendingId: null,
        },
      ];
    }).flat();

    const started = performance.now();
    const response = await POST(
      new Request("http://localhost/api/sync", {
        method: "POST",
        body: JSON.stringify({ entries }),
      }) as never,
    );
    const took = performance.now() - started;
    const { results } = (await response.json()) as { results: { status: string }[] };
    console.log(`sync of ${entries.length} entries: ${Math.round(took)} ms`);
    expect(results.filter((result) => result.status === "ok")).toHaveLength(50);
    expect(took).toBeLessThan(10_000);
  }, 60_000);

  it(`the offline copy of ${CUSTOMERS} customers builds in under 3 s`, async () => {
    const started = performance.now();
    const response = await GET();
    const took = performance.now() - started;
    const body = (await response.json()) as { cache: OfflineCache };
    const size = JSON.stringify(body).length;
    console.log(
      `cache: ${body.cache.customers.length} customers, ${Math.round(size / 1024)} KB, ${Math.round(took)} ms`,
    );
    expect(body.cache.customers.length).toBeGreaterThanOrEqual(CUSTOMERS);
    expect(took).toBeLessThan(3_000);
  }, 60_000);
});
