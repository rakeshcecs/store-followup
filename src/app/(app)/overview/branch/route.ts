import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { branchChoiceFor, writeBranchCookie } from "@/lib/current-branch";

// M14.05 "Tapping a notification opens the right screen": the 8 PM summary names a branch
// ("Today at Branch B", or all branches for an admin), so its link switches to that
// branch and opens the overview. Only to a branch the reader may use; anything else
// opens the overview on the branch they already had.
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.mustChangePin) redirect("/set-pin");

  const to = request.nextUrl.searchParams.get("to");
  // A link prefetched in the bell list must not switch the branch before the tap.
  const prefetch = request.headers.has("next-router-prefetch");
  if (to && !prefetch) {
    const choice = await branchChoiceFor(user, to);
    if (choice) await writeBranchCookie(choice);
  }
  redirect("/overview");
}
