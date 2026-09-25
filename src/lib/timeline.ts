// The customer timeline (M06 renders it; M05 writes its first row).
//
// `TimelineEvent.title` is shown on screen, so it cannot hold English: the row stores a
// next-intl key and the screen turns it into the reader's language. Same choice as
// `Notification.message` in M02 — the language belongs to whoever is reading, not to
// whoever wrote the row, and a stored sentence would be frozen in one language for ever.
//
// Every kind the profile shows is listed here up front, so M07–M15 only call
// writeTimelineEvent() with their own kind and never touch the screen.
import type { FollowUpResult, Prisma } from "@/generated/prisma/client";

export const TIMELINE = {
  customerAdded: { type: "customer.added", title: "timeline.customerAdded" },
  detailsEdited: { type: "customer.edited", title: "timeline.detailsEdited" },
  reassigned: { type: "customer.reassigned", title: "timeline.reassigned" },
  visit: { type: "visit.recorded", title: "timeline.visit" },
  followUpSet: { type: "followup.set", title: "timeline.followUpSet" },
  followUpResult: { type: "followup.result", title: "timeline.followUpResult" },
  saleCompleted: { type: "sale.completed", title: "timeline.saleCompleted" },
  saleEdited: { type: "sale.edited", title: "timeline.saleEdited" },
  saleCancelled: { type: "sale.cancelled", title: "timeline.saleCancelled" },
  notInterested: { type: "enquiry.lost", title: "timeline.notInterested" },
  // M24: "Imported on 24 Sep 2026 by Amit", and details an import filled in later.
  imported: { type: "customer.imported", title: "timeline.imported" },
  importUpdated: { type: "customer.importUpdated", title: "timeline.importUpdated" },
  // M22: WhatsApp out and in (the profile adds the ticks), consent given, and STOP.
  whatsappOut: { type: "wa.sent", title: "timeline.whatsappOut" },
  whatsappIn: { type: "wa.received", title: "timeline.whatsappIn" },
  whatsappConsent: { type: "customer.whatsappConsent", title: "timeline.whatsappConsent" },
  whatsappStop: { type: "customer.whatsappStop", title: "timeline.whatsappStop" },
} as const;

export type TimelineKind = keyof typeof TIMELINE;

// M09: a follow-up call reads by its result — "Follow-up call · Spoke, will visit Sun,
// 27 Sep". The ones with a next day point at the new follow-up (entityId), and the
// profile fills in its date in the reader's language, as for "Follow-up set for …".
export const FOLLOW_UP_CALL_TITLE: Record<FollowUpResult, string> = {
  WILL_VISIT: "timeline.followUpCall.WILL_VISIT",
  CALL_LATER: "timeline.followUpCall.CALL_LATER",
  NOT_REACHABLE: "timeline.followUpCall.NOT_REACHABLE",
  ALREADY_BOUGHT: "timeline.followUpCall.ALREADY_BOUGHT",
  NOT_INTERESTED: "timeline.followUpCall.NOT_INTERESTED",
};

// Who a row is by when no one on the staff did it (M22): the customer, writing on
// WhatsApp, or the app itself — sending an automatic message, or setting an occasion
// follow-up (M23).
export function systemByline(type: string): string {
  if (type === TIMELINE.whatsappIn.type || type === TIMELINE.whatsappStop.type)
    return "timeline.byCustomer";
  if (type.startsWith("followup.")) return "timeline.bySystem";
  return "timeline.byApp";
}

export type TimelineTone = "amber" | "green" | "grey" | "indigo";

// The dot colour, from the stored type rather than the kind, so a row written by an
// older build still gets a colour (M06): follow-up due = amber, sale = green, not
// interested = grey, everything else indigo. A cancelled sale is not a sale any more,
// so only `sale.completed` is green.
export function timelineTone(type: string): TimelineTone {
  if (type.startsWith("followup.")) return "amber";
  if (type === TIMELINE.saleCompleted.type) return "green";
  if (type === TIMELINE.notInterested.type) return "grey";
  return "indigo";
}

export async function writeTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    staffId: string | null; // null: nobody on the staff (a WhatsApp reply, an automatic message)
    kind: TimelineKind;
    detail?: string;
    entityId?: string; // the record the row is about, e.g. the Sale
    branchId?: string; // where it happened; left out for rows that belong to no branch
    title?: string; // a more exact message key than the kind's own, e.g. FOLLOW_UP_CALL_TITLE
  },
): Promise<void> {
  const { type } = TIMELINE[input.kind];
  const title = input.title ?? TIMELINE[input.kind].title;
  await tx.timelineEvent.create({
    data: {
      customerId: input.customerId,
      staffId: input.staffId,
      type,
      title,
      detail: input.detail ?? null,
      entityId: input.entityId ?? null,
      branchId: input.branchId ?? null,
    },
  });
}

// The timeline row keeps the two names as JSON in `detail`; the profile turns them into
// "Reassigned from Amit to Priya" in the reader's language.
export function reassignDetail(from: string, to: string): string {
  return JSON.stringify({ from, to });
}

export function readReassignDetail(detail: string | null): { from: string; to: string } | null {
  if (!detail) return null;
  try {
    const value = JSON.parse(detail) as unknown;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { from?: unknown }).from === "string" &&
      typeof (value as { to?: unknown }).to === "string"
    ) {
      return value as { from: string; to: string };
    }
  } catch {
    // an older plain-text detail: shown as it is
  }
  return null;
}
