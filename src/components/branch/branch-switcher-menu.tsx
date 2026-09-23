"use client";

import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { setCurrentBranch } from "@/lib/actions/current-branch";
import { ALL_BRANCHES } from "@/lib/permissions";

type BranchSwitcherMenuProps = {
  branches: { id: string; name: string }[];
  current: string; // a branch id, or "all"
  canSeeAll: boolean;
};

const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-[15px] outline-none select-none data-highlighted:bg-primary-light";

export function BranchSwitcherMenu({ branches, current, canSeeAll }: BranchSwitcherMenuProps) {
  const t = useTranslations("branch");
  const tError = useErrorMessage(); // action errors arrive as full message keys
  const [pending, startTransition] = useTransition();

  const nameOf = (branchId: string) =>
    branchId === ALL_BRANCHES
      ? t("all")
      : (branches.find((branch) => branch.id === branchId)?.name ?? t("label"));

  function choose(branchId: string) {
    if (branchId === current) return;
    startTransition(async () => {
      const result = await setCurrentBranch({ branchId });
      if (result.ok) toast(t("switched", { name: nameOf(branchId) }));
      else toast.error(tError(result.message));
    });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t("switch")}
        disabled={pending}
        className="flex min-h-11 max-w-45 items-center gap-1 rounded-md px-2.5 text-[15px] font-bold text-ink-2 hover:bg-black/5 disabled:opacity-60"
      >
        <span className="truncate">{nameOf(current)}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-52 rounded-xl border border-border bg-card p-1.5 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.3)]"
        >
          <DropdownMenu.RadioGroup value={current} onValueChange={choose}>
            {canSeeAll && (
              <DropdownMenu.RadioItem value={ALL_BRANCHES} className={itemClass}>
                <ItemLabel label={t("all")} />
              </DropdownMenu.RadioItem>
            )}
            {branches.map((branch) => (
              <DropdownMenu.RadioItem key={branch.id} value={branch.id} className={itemClass}>
                <ItemLabel label={branch.name} />
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ItemLabel({ label }: { label: string }) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check aria-hidden className="size-4 text-primary" />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="truncate">{label}</span>
    </>
  );
}
