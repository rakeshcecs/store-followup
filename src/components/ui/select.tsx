import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { Field, fieldControlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type SelectProps = Omit<ComponentProps<"select">, "id"> & {
  label: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string; // shown as a disabled first option
};

// Native <select>: the phone's own picker is the easiest to use.
export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  ...props
}: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <div className="relative">
          <select
            data-slot="select"
            className={cn(
              fieldControlClass,
              "h-13 appearance-none rounded-md pr-11 pl-3.5 text-[17px]",
              className,
            )}
            {...control}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      )}
    </Field>
  );
}
