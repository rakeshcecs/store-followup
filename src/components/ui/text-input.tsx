import type { ComponentProps } from "react";
import { Field, fieldControlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type TextInputProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextInput({ label, hint, error, className, ...props }: TextInputProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <input
          data-slot="text-input"
          className={cn(fieldControlClass, "h-13 rounded-md px-3.5 text-[17px]", className)}
          {...control}
          {...props}
        />
      )}
    </Field>
  );
}
