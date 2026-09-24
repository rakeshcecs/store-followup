// The status pill on the customer profile (M06, SOW section 6.1). A pure function, so the
// dashboard (M12) and the reports (M13) can show the same pill without their own copy of
// the rules.
import type { EnquiryStatus } from "@/generated/prisma/client";
import { isoDate } from "@/lib/format";

export type CustomerStatus =
  "new" | "visited" | "followUpPending" | "followUpOverdue" | "saleCompleted" | "notInterested";

export type CustomerStatusTone = "blue" | "red" | "green" | "grey";

export const CUSTOMER_STATUS_TONE: Record<CustomerStatus, CustomerStatusTone> = {
  new: "grey",
  visited: "blue",
  followUpPending: "blue",
  followUpOverdue: "red",
  saleCompleted: "green",
  notInterested: "grey",
};

type StatusInput = {
  // The newest enquiry's status, or null when the customer has none yet.
  latestEnquiry: EnquiryStatus | null;
  // The due date of the customer's pending follow-up (BR-02 allows one), or null.
  pendingFollowUpDue: Date | null;
  now: Date;
};

// Decided by the newest enquiry, not by "any enquiry ever": a customer who bought last
// year and walked in again today has an open enquiry now, and that is what the person
// holding the phone needs to see.
export function customerStatus({
  latestEnquiry,
  pendingFollowUpDue,
  now,
}: StatusInput): CustomerStatus {
  if (latestEnquiry === null) return "new";
  if (latestEnquiry === "SALE_COMPLETED") return "saleCompleted";
  if (latestEnquiry === "NOT_INTERESTED") return "notInterested";
  if (pendingFollowUpDue === null) return "visited";
  return isOverdue(pendingFollowUpDue, now) ? "followUpOverdue" : "followUpPending";
}

// BR-09: overdue when the due date is before today — today in the shop, i.e. IST. The due
// date is a @db.Date read back as UTC midnight, so its UTC calendar day is the stored day.
export function isOverdue(dueDate: Date, now: Date): boolean {
  return dueDate.toISOString().slice(0, 10) < isoDate(now);
}
