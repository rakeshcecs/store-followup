"use client";

import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string; description?: string };

type OptionListProps = {
  label: string; // accessible name of the group
  options: Option[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

// Big radio cards with an optional sub-label (e.g. visit outcome).
export function OptionList({
  label,
  options,
  value,
  onValueChange,
  disabled,
  className,
}: OptionListProps) {
  return (
    <RadioGroup.Root
      data-slot="option-list"
      aria-label={label}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      className={cn("flex flex-col gap-2.5", className)}
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className="group flex min-h-15 w-full items-center gap-3 rounded-lg border-[1.5px] border-input bg-card px-4 py-2.5 text-left text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-primary data-[state=checked]:bg-primary-selected data-[state=checked]:text-primary-hover"
        >
          <span
            aria-hidden
            className="size-5 shrink-0 rounded-full border-2 border-dot group-data-[state=checked]:border-[6px] group-data-[state=checked]:border-primary"
          />
          <span>
            {o.label}
            {o.description && (
              <small className="mt-0.5 block text-[13px] font-medium text-muted-foreground">
                {o.description}
              </small>
            )}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
