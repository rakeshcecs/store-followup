// M19: the shapes kept on the phone. Plain data only, so the server, the page and the
// service worker can all import this file.
import type { ConflictReason, EntryKind } from "@/lib/sync/entries";

export type Slot = "MORNING" | "AFTERNOON" | "EVENING";
export type Method = "CALL" | "WHATSAPP" | "VISIT";
export type Option = { id: string; name: string };

export type CachedCustomer = {
  id: string; // a server id, or the clientId of one added offline
  name: string;
  mobile: string;
  altMobile: string | null;
  area: string | null;
  city: string | null;
  assignedToId: string;
  assignedToName: string;
  openEnquiryTitle: string | null;
  pending: { id: string; dueDate: string; timeSlot: Slot; assignedToId: string } | null;
};

export type CachedFollowUp = {
  id: string;
  customerId: string;
  customerName: string;
  mobile: string | null;
  enquiryTitle: string;
  dueDate: string; // "2026-09-25"
  timeSlot: Slot;
  method: Method;
  reason: string | null;
  notReachableCount: number;
};

export type OfflineCache = {
  version: 1;
  savedAt: string; // ISO time of the refresh
  today: string; // the server's "today" (IST) at that time
  user: { id: string; name: string; role: "SALESPERSON" | "MANAGER" | "ADMIN"; language: string };
  // Null when an admin was on "All branches": nothing can be written until one is picked.
  branch: { id: string; name: string; city: string } | null;
  lists: {
    categories: Option[];
    reasons: Option[];
    departments: Option[];
    staff: Option[];
    billAmountRequired: boolean;
  };
  customers: CachedCustomer[];
  followUps: CachedFollowUp[];
  overdueCount: number;
};

// One form saved on the phone, waiting to be sent (plain view; stored encrypted).
export type OutboxStatus = "waiting" | "attention" | "blocked";

export type OutboxEntry = {
  id: string; // the entry's id = the clientId of the record it makes
  kind: EntryKind;
  at: string; // ISO time it was saved
  branchId: string;
  userId: string; // whose entry this is
  input: Record<string, unknown>;
  seenPendingId?: string | null;
  force?: boolean;
  status: OutboxStatus;
  // Set when the server said no: what to show under "Needs your attention".
  problem?: {
    reason: ConflictReason | "error";
    message: string;
    values?: Record<string, string | number>;
  };
};
