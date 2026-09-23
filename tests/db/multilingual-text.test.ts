// M18.05: customer names and remarks are typed in any language and stay searchable.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  makeBranch,
  makeCustomer,
  makeEnquiry,
  makeUser,
  nextMobile,
} from "../helpers/branch-access";

const GUJARATI = "રમેશ પટેલ";
const HINDI = "रमेश पटेल";
const GUJARATI_REMARK = "ગ્રાહકને લગ્ન માટે સાડી જોઈએ છે. આવતા અઠવાડિયે ફરી આવશે.";

afterAll(() => db.$disconnect());

describe("names and remarks in Hindi and Gujarati", () => {
  it("come back exactly as they were typed, and are findable", async () => {
    const branch = await makeBranch();
    const staff = await makeUser({ role: "SALESPERSON", homeBranchId: branch.id });

    const gujaratiMobile = nextMobile();
    await makeCustomer(branch.id, staff.id, gujaratiMobile);
    await db.customer.update({ where: { mobile: gujaratiMobile }, data: { name: GUJARATI } });

    const hindiMobile = nextMobile();
    await makeCustomer(branch.id, staff.id, hindiMobile);
    await db.customer.update({ where: { mobile: hindiMobile }, data: { name: HINDI } });

    // Exact equality: proves nothing was mangled or cut short on the way to MySQL.
    expect((await db.customer.findUnique({ where: { mobile: gujaratiMobile } }))?.name).toBe(
      GUJARATI,
    );
    expect((await db.customer.findUnique({ where: { mobile: hindiMobile } }))?.name).toBe(HINDI);

    // Searching a Gujarati surname finds the Gujarati customer, not the Hindi one.
    const found = await db.customer.findMany({
      where: { name: { contains: "પટેલ" }, mobile: { in: [gujaratiMobile, hindiMobile] } },
      select: { mobile: true },
    });
    expect(found.map((row) => row.mobile)).toEqual([gujaratiMobile]);

    // A word from the middle of the name matches too.
    const middle = await db.customer.findMany({
      where: { name: { contains: "મેશ" }, mobile: { in: [gujaratiMobile] } },
    });
    expect(middle).toHaveLength(1);
  });

  it("keeps a whole Gujarati sentence in a visit remark", async () => {
    const branch = await makeBranch();
    const staff = await makeUser({ role: "SALESPERSON", homeBranchId: branch.id });
    const customer = await makeCustomer(branch.id, staff.id);
    const enquiry = await makeEnquiry(customer.id, staff.id);

    const visit = await db.visit.create({
      data: {
        branchId: branch.id,
        customerId: customer.id,
        enquiryId: enquiry.id,
        clientId: randomUUID(),
        visitAt: new Date(),
        salespersonId: staff.id,
        outcome: "DECIDE_LATER",
        visitType: "NEW",
        remarks: GUJARATI_REMARK,
      },
    });

    expect((await db.visit.findUnique({ where: { id: visit.id } }))?.remarks).toBe(GUJARATI_REMARK);

    const found = await db.visit.findMany({
      where: { id: visit.id, remarks: { contains: "સાડી" } },
    });
    expect(found).toHaveLength(1);
  });
});

describe("collation", () => {
  it("is the same on every column, so search behaves the same everywhere", async () => {
    // Prisma's `mode: "insensitive"` is PostgreSQL only. On MySQL, case and accent
    // handling come from the column collation, so a stray one changes search results.
    const rows = (await db.$queryRawUnsafe(`
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLLATION_NAME AS collationName
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLLATION_NAME IS NOT NULL
        AND COLLATION_NAME <> 'utf8mb4_0900_ai_ci'
        AND TABLE_NAME <> '_prisma_migrations'
    `)) as { tableName: string; columnName: string }[];

    expect(rows.map((row) => `${row.tableName}.${row.columnName}`)).toEqual([]);
  });
});
