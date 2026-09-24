// Pure rules for recording a visit (M07), kept apart from the action so they can be
// tested without a database.
import type { VisitType } from "@/generated/prisma/client";
import { isoDate } from "@/lib/format";

// BR-13: "A customer is New on the day of their first visit and Existing on later
// visits." A second visit on that same day is still New; the day is the shop's (IST).
export function visitTypeFor(firstVisitAt: Date | null, now: Date): VisitType {
  if (firstVisitAt === null) return "NEW";
  return isoDate(firstVisitAt) === isoDate(now) ? "NEW" : "EXISTING";
}

// SOW 5.4: the enquiry title is "made from the first two categories", e.g. "Sherwani,
// Wedding Clothes". English, like every stored label: the title is a record, not a
// screen string, and one language keeps reports and exports consistent.
export function enquiryTitle(categoryNames: string[]): string {
  return categoryNames.slice(0, 2).join(", ").slice(0, 150);
}
