import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex w-full items-center justify-center gap-2 font-bold no-underline transition-colors disabled:cursor-not-allowed disabled:border-0 disabled:bg-surface-disabled disabled:text-muted-foreground [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "border-[1.5px] border-input bg-card text-foreground hover:bg-[#fbfaf7]",
      },
      size: {
        default: "min-h-13 rounded-lg px-4.5 text-base",
        sm: "min-h-11 rounded-md px-2.5 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean; // render a child <a>/<Link> with button styles
  };

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
