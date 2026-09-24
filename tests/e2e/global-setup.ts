import { db } from "@/lib/db";

// makeStaff() without a branch uses the oldest active branch. Locally that is the seeded
// Main branch; CI runs on a migrated but unseeded database, where the oldest branch used
// to be whichever private branch a parallel spec created first — the lockout test's, say.
// Other specs' users then sat in it, and its afterAll could not delete it (a foreign key
// on homeBranchId). Making sure a shared branch exists before any worker starts keeps
// every private branch private.
export default async function globalSetup() {
  const any = await db.branch.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
  if (!any) {
    await db.branch.create({
      data: {
        name: "E2E Shared Branch",
        address: "1 Test Road",
        city: "Ahmedabad",
        phone: "9825012345",
      },
    });
  }
  await db.$disconnect();
}
