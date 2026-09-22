import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Error text under a field. Give it an id and point the field's aria-describedby at it.
export function FieldError({ className, children, ...props }: ComponentProps<"p">) {
  if (!children) return null;
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn("mt-1.5 text-sm font-semibold text-danger", className)}
      {...props}
    >
      {children}
    </p>
  );
}
