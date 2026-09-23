"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SortableRowProps = {
  id: string;
  dragLabel: string; // accessible name for the handle
  children: ReactNode;
};

// One row of a master list. Only the handle starts a drag, so the buttons inside the row
// still work with a finger — dragging the whole card would swallow every tap.
export function SortableRow({ id, dragLabel, children }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-80")}
    >
      <Card className="flex items-start gap-2 p-3">
        <button
          type="button"
          aria-label={dragLabel}
          // touch-none: the browser would otherwise scroll the page instead of dragging.
          className="flex size-11 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-black/5"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden className="size-5" />
        </button>
        <div className="min-w-0 grow">{children}</div>
      </Card>
    </li>
  );
}
