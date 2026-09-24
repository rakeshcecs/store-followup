import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { StaffForm } from "@/app/(app)/staff/staff-form";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";
import { staffInScope } from "@/lib/staff-scope";

export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== "ADMIN") notFound(); // a manager may read the list, not edit it
  const scope = await getBranchScope(user);
  const t = await getTranslations("staff");

  const staff = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      mobile: true,
      role: true,
      homeBranchId: true,
      departmentId: true,
      joinedOn: true,
      language: true,
      extraBranches: { select: { branchId: true } },
    },
  });
  // Out of the current branch scope is the same answer as not existing.
  if (!staff || !staffInScope(staff, scope)) notFound();

  const [branches, departments] = await Promise.all([
    db.branch.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.department.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <AppShell
      role={user.role}
      title={t("editOne", { name: staff.fullName })}
      backHref="/staff"
      backLabel={t("back")}
    >
      <StaffForm
        branches={branches}
        coverableBranches={branches}
        departments={departments}
        staff={{
          id: staff.id,
          fullName: staff.fullName,
          mobile: staff.mobile,
          role: staff.role,
          homeBranchId: staff.homeBranchId,
          departmentId: staff.departmentId,
          // <input type="date"> wants "2026-09-23", and isoDate reads the day in IST.
          joinedOn: staff.joinedOn ? isoDate(staff.joinedOn) : null,
          extraBranchIds: staff.extraBranches.map((row) => row.branchId),
          language: staff.language,
        }}
      />
    </AppShell>
  );
}
