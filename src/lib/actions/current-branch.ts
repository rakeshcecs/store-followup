"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { BRANCH_COOKIE, BRANCH_COOKIE_MAX_AGE } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ALL_BRANCHES, branchScope } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { setCurrentBranchInput } from "@/lib/validation/branch";

// Changes the branch the user is looking at. Cross-cutting, so it lives in lib/actions
// rather than in one route folder.
export const setCurrentBranch = safeAction({
  name: "setCurrentBranch",
  schema: setCurrentBranchInput,
  auth: {},
  handler: async ({ branchId }, { user }) => {
    branchScope(user, branchId); // FORBIDDEN if they may not use this branch

    if (branchId !== ALL_BRANCHES) {
      const branch = await db.branch.findFirst({
        where: { id: branchId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!branch) throw new AppError("NOT_FOUND");
    }

    (await cookies()).set(BRANCH_COOKIE, branchId, {
      httpOnly: true, // only the server reads it; the switcher gets the value as a prop
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: BRANCH_COOKIE_MAX_AGE,
    });

    // The branch changes every list on every screen.
    revalidatePath("/", "layout");
    return { branchId };
  },
});
