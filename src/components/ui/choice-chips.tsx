"use client";

import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type CommonProps = {
  label: string; // accessible name of the group (visible label is up to the screen)
  options: Option[];
  disabled?: boolean;
  className?: string;
};

type SingleProps = CommonProps & {
  type: "single";
  value: string;
  onValueChange: (value: string) => void;
};

type MultipleProps = CommonProps & {
  type: "multiple";
  value: string[];
  onValueChange: (value: string[]) => void;
};

const chipClass =
  "min-h-11 rounded-full border-[1.5px] border-input bg-card px-4 text-sm font-semibold transition-colors data-[state=on]:border-primary data-[state=on]:bg-primary-light data-[state=on]:text-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

// Pill-shaped choices. Single mode keeps one chip selected (tapping it again does not clear it).
export function ChoiceChips(props: SingleProps | MultipleProps) {
  const { label, options, disabled, className } = props;
  const items = options.map((o) => (
    <ToggleGroup.Item key={o.value} value={o.value} className={chipClass}>
      {o.label}
    </ToggleGroup.Item>
  ));
  const groupClass = cn("flex flex-wrap gap-2", className);

  if (props.type === "single") {
    return (
      <ToggleGroup.Root
        data-slot="choice-chips"
        type="single"
        aria-label={label}
        value={props.value}
        onValueChange={(v) => v && props.onValueChange(v)}
        disabled={disabled}
        className={groupClass}
      >
        {items}
      </ToggleGroup.Root>
    );
  }

  return (
    <ToggleGroup.Root
      data-slot="choice-chips"
      type="multiple"
      aria-label={label}
      value={props.value}
      onValueChange={props.onValueChange}
      disabled={disabled}
      className={groupClass}
    >
      {items}
    </ToggleGroup.Root>
  );
}
