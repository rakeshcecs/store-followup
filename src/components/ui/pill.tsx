import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-extrabold whitespace-nowrap",
  {
    variants: {
      tone: {
        blue: "bg-primary-light text-primary",
        red: "bg-danger-light text-danger",
        green: "bg-success-light text-success",
        grey: "bg-grey-light text-ink-2",
        amber: "bg-warning-light text-warning",
      },
    },
    defaultVariants: { tone: "grey" },
  },
);

type PillProps = ComponentProps<"span"> & VariantProps<typeof pillVariants>;

export function Pill({ className, tone, ...props }: PillProps) {
  return <span data-slot="pill" className={cn(pillVariants({ tone }), className)} {...props} />;
}
