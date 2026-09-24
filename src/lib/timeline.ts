// The customer timeline (M06 renders it; M05 writes its first row).
//
// `TimelineEvent.title` is shown on screen, so it cannot hold English: the row stores a
// next-intl key and the screen turns it into the reader's language. Same choice as
// `Notification.message` in M02 — the language belongs to whoever is reading, not to
// whoever wrote the row, and a stored sentence would be frozen in one language for ever.
import type { Prisma } from "@/generated/prisma/client";

export const TIMELINE = {
  customerAdded: { type: "customer.added", title: "timeline.customerAdded" },
} as const;

export type TimelineKind = keyof typeof TIMELINE;

export async function writeTimelineEvent(
  tx: Prisma.TransactionClient,
  input: { customerId: string; staffId: string; kind: TimelineKind; detail?: string },
): Promise<void> {
  const { type, title } = TIMELINE[input.kind];
  await tx.timelineEvent.create({
    data: {
      customerId: input.customerId,
      staffId: input.staffId,
      type,
      title,
      detail: input.detail ?? null,
    },
  });
}
