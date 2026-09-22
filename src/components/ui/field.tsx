import { useId, type ReactNode } from "react";
import { FieldError } from "@/components/ui/field-error";

export const fieldControlClass =
  "w-full border-[1.5px] border-input bg-card focus:border-primary focus:outline-2 focus:outline-offset-1 focus:outline-primary aria-invalid:border-danger aria-invalid:focus:outline-danger disabled:bg-surface-disabled disabled:text-muted-foreground";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: (control: {
    id: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
};

// Label + control + hint/error, with the aria wiring done once for every input type.
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div data-slot="field">
      <label htmlFor={id} className="mb-2 block text-sm font-bold text-ink-2">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
