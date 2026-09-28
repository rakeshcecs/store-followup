// M18.03: an enquiry title and a history row's not-interested reason are saved as the
// items' English names; a Hindi or Gujarati reader sees them in their own language.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => (await import("../helpers/session")).sessionCookieStore(),
  headers: async () => new Headers([["user-agent", "vitest"]]),
}));

const { db } = await import("@/lib/db");
const { enquiryTitleTranslator } = await import("@/lib/master-list-text");
const { customerTimeline } = await import("@/lib/customers");
const { writeTimelineEvent } = await import("@/lib/timeline");
const { makeBranch, makeCustomer, makeUser } = await import("../helpers/branch-access");

afterAll(() => db.$disconnect());

describe("master list names saved as text", () => {
  it("shows an enquiry title and a reason in the reader's language", async () => {
    const tag = randomUUID().slice(0, 6);
    const [one, two] = await Promise.all(
      [`Sherwani ${tag}`, `Wedding ${tag}`].map((nameEn, i) =>
        db.requirementCategory.create({
          data: {
            nameEn,
            nameHi: i === 0 ? `शेरवानी ${tag}` : "",
            nameGu: `શેરવાની ${tag}`,
            sortOrder: 90 + i,
          },
        }),
      ),
    );
    const reason = await db.lostReason.create({
      data: { nameEn: `Too costly ${tag}`, nameHi: `बहुत महंगा ${tag}`, nameGu: "", sortOrder: 90 },
    });

    const title = `${one!.nameEn}, ${two!.nameEn}`;
    // Hindi: the second has no Hindi name, so it stays English; an imported title as typed.
    expect((await enquiryTitleTranslator("hi"))(title)).toBe(`शेरवानी ${tag}, ${two!.nameEn}`);
    expect((await enquiryTitleTranslator("gu"))(title)).toBe(`શેરવાની ${tag}, ${two!.nameGu}`);
    expect((await enquiryTitleTranslator("en"))(title)).toBe(title);
    expect((await enquiryTitleTranslator("hi"))("Imported: gold border")).toBe(
      "Imported: gold border",
    );

    const branch = await makeBranch();
    const staff = await makeUser({ role: "SALESPERSON", homeBranchId: branch.id });
    const customer = await makeCustomer(branch.id, staff.id);
    await db.$transaction(async (tx) => {
      await writeTimelineEvent(tx, {
        customerId: customer.id,
        staffId: staff.id,
        branchId: branch.id,
        kind: "notInterested",
        detail: reason.nameEn,
      });
      await writeTimelineEvent(tx, {
        customerId: customer.id,
        staffId: staff.id,
        branchId: branch.id,
        kind: "followUpResult",
        title: "timeline.followUpCall.NOT_INTERESTED",
        detail: `${reason.nameEn} · will think`,
      });
    });
    const { events } = await customerTimeline(customer.id, 10, "hi");
    expect(events.map((event) => event.detail).sort()).toEqual(
      [`बहुत महंगा ${tag}`, `बहुत महंगा ${tag} · will think`].sort(),
    );
  });
});
