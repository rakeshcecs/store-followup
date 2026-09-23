import { BranchSwitcherMenu } from "@/components/branch/branch-switcher-menu";
import { getUser } from "@/lib/auth";
import { getCurrentBranch, switchableBranches } from "@/lib/current-branch";
import { canSeeAllBranches } from "@/lib/permissions";

// Shown in the top bar for anyone who can look at more than one branch.
// A salesperson with a single branch sees nothing at all.
//
// getUser, not requireUser: a layout guard and the page below it render at the same
// time, so throwing here would log an error on every request to a page the guard is
// already turning away. Permission checks that matter happen in the Server Actions.
export async function BranchSwitcher() {
  const user = await getUser();
  if (!user) return null;

  const [branches, current] = await Promise.all([switchableBranches(user), getCurrentBranch(user)]);
  const canSeeAll = canSeeAllBranches(user);

  if (branches.length <= 1 && !canSeeAll) return null;

  return <BranchSwitcherMenu branches={branches} current={current} canSeeAll={canSeeAll} />;
}
