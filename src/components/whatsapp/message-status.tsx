import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import type { MessageStatus } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

const ICON = {
  QUEUED: Clock,
  SENT: Check,
  DELIVERED: CheckCheck,
  READ: CheckCheck,
  FAILED: AlertCircle,
} as const;

// M22: the ticks — one grey (sent), two grey (delivered), two blue (read), red (not sent),
// a clock while it waits for the worker. With the word, for screen readers and clarity.
export function MessageStatusTicks({ status, label }: { status: MessageStatus; label: string }) {
  const Icon = ICON[status];
  return (
    <span
      data-testid="whatsapp-status"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1 text-[13px] font-bold",
        status === "READ" && "text-primary",
        status === "FAILED" && "text-danger",
        (status === "SENT" || status === "DELIVERED" || status === "QUEUED") &&
          "text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </span>
  );
}
