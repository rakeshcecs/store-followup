"use client";

import { AlertDialog } from "radix-ui";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  trigger?: ReactNode; // element that opens the dialog (or control it with open/onOpenChange)
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  children?: ReactNode; // sits between the text and the buttons, e.g. a one-time PIN
};

// Bottom sheet on phones, centred dialog on larger screens.
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-[rgba(20,20,30,0.5)]" />
        <AlertDialog.Content
          data-slot="confirm-dialog"
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-4 rounded-t-2xl bg-background px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)] sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5"
        >
          <AlertDialog.Title className="font-heading-style text-xl">{title}</AlertDialog.Title>
          {description ? (
            <AlertDialog.Description className="text-[15px] leading-relaxed text-ink-2">
              {description}
            </AlertDialog.Description>
          ) : (
            <AlertDialog.Description className="sr-only">{title}</AlertDialog.Description>
          )}
          {children}
          <div className="flex flex-col gap-2.5">
            <AlertDialog.Action
              onClick={onConfirm}
              className={cn(buttonVariants(), danger && "bg-danger hover:bg-danger-text")}
            >
              {confirmLabel}
            </AlertDialog.Action>
            <AlertDialog.Cancel className={buttonVariants({ variant: "secondary" })}>
              {cancelLabel}
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
