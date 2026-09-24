// Departments chosen on a form (staff M03, customers M05/M06).
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

// A department switched off "stops being offered on new ones" (M03 decisions), and the
// id arrives in a form post, so the server checks it: it must exist and be active — or
// be the one the record already has, which stays valid after it was switched off.
export async function assertDepartmentUsable(
  departmentId: string | undefined,
  current: string | null = null,
): Promise<void> {
  if (!departmentId || departmentId === current) return;
  const department = await db.department.findFirst({
    where: { id: departmentId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!department) {
    throw new AppError("NOT_FOUND", {
      message: "departments.errors.unavailable",
      field: "departmentId",
    });
  }
}
