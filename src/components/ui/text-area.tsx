import type { ComponentProps } from "react";
import { Field, fieldControlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type TextAreaProps = Omit<ComponentProps<"textarea">, "id"> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextArea({ label, hint, error, className, ...props }: TextAreaProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <textarea
          data-slot="text-area"
          className={cn(
            fieldControlClass,
            "min-h-21 resize-none rounded-md px-3.5 py-3 text-base",
            className,
          )}
          {...control}
          {...props}
        />
      )}
    </Field>
  );
}
