import { getInitials } from "@/lib/initials";
import { cn } from "@/lib/utils";

type AvatarProps = { name: string; size?: "default" | "lg"; className?: string };

export function Avatar({ name, size = "default", className }: AvatarProps) {
  return (
    <span
      data-slot="avatar"
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary-light font-extrabold text-primary",
        size === "lg" ? "size-14 text-lg" : "size-11 text-[15px]",
        className,
      )}
    >
      {getInitials(name)}
    </span>
  );
}
