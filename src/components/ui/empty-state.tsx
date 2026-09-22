import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, text, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center gap-2 p-4.5 text-center", className)}
    >
      {Icon && <Icon aria-hidden className="size-8 text-muted-foreground" />}
      <p className="text-[15px] font-bold text-ink-2">{title}</p>
      {text && <p className="text-[15px] text-muted-foreground">{text}</p>}
      {action && <div className="mt-2 w-full max-w-xs">{action}</div>}
    </div>
  );
}
