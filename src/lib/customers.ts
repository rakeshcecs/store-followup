// Reading customers (M05, M06). M07's visit screen calls the same helpers.
//
// Nothing here filters by branch, on purpose: customers are shared across branches
// (BR-16), and the whole point of searching by mobile is that anyone can find anyone
// before creating a second row for the same person (BR-01). Visits, follow-ups and
// sales are the branch-scoped part, and they arrive in M07 onwards.
import type { SessionUser } from "@/lib/auth";
import { customerStatus, type CustomerStatus } from "@/lib/customer-status";
import { db } from "@/lib/db";
import { normalizeMobile } from "@/lib/mobile";

// What the "Existing customer" card shows (M05.04).
export type CustomerCard = {
  id: string;
  name: string;
  mobile: string | null;
  assignedToName: string;
  visitCount: number;
  lastVisitAt: Date | null;
  openEnquiryTitle: string | null;
};

const cardSelect = {
  id: true,
  name: true,
  mobile: true,
  assignedTo: { select: { fullName: true } },
  _count: { select: { visits: true } },
  visits: { orderBy: { visitAt: "desc" }, take: 1, select: { visitAt: true } },
  enquiries: { where: { status: "OPEN" }, take: 1, select: { title: true } },
} as const;

type CardRow = {
  id: string;
  name: string;
  mobile: string | null;
  assignedTo: { fullName: string };
  _count: { visits: number };
  visits: { visitAt: Date }[];
  enquiries: { title: string }[];
};

function toCard(row: CardRow): CustomerCard {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    assignedToName: row.assignedTo.fullName,
    visitCount: row._count.visits,
    lastVisitAt: row.visits[0]?.visitAt ?? null,
    // BR-02 allows at most one open enquiry, so the first row is the only row.
    openEnquiryTitle: row.enquiries[0]?.title ?? null,
  };
}

// Exact match only, on either number (M05.04). Not a "contains" search: a partial
// number would show one customer's details to someone who guessed five digits.
export async function findByMobile(value: string): Promise<CustomerCard | null> {
  const mobile = normalizeMobile(value);
  if (!mobile) return null;

  const row = await db.customer.findFirst({
    where: { active: true, OR: [{ mobile }, { altMobile: mobile }] },
    select: cardSelect,
  });
  return row ? toCard(row) : null;
}

export type RecentCustomer = { id: string; name: string; subtitle: string | null };

// The five customers this person touched most recently (M05.11). "Touched" is their own
// timeline events — the row every visit, follow-up and sale already writes — rather than
// who the customer is assigned to, so handling someone else's customer counts too.
export async function recentlyHandledBy(userId: string, take = 5): Promise<RecentCustomer[]> {
  const events = await db.timelineEvent.findMany({
    where: { staffId: userId, customer: { active: true } },
    orderBy: { createdAt: "desc" },
    // One customer can have many events; ask for enough rows to still find five
    // different people, then collapse them.
    take: take * 10,
    select: {
      customerId: true,
      customer: {
        select: { id: true, name: true, enquiries: { where: { status: "OPEN" }, take: 1 } },
      },
    },
  });

  const seen = new Map<string, RecentCustomer>();
  for (const event of events) {
    if (seen.size >= take) break;
    if (seen.has(event.customerId)) continue;
    seen.set(event.customerId, {
      id: event.customer.id,
      name: event.customer.name,
      subtitle: event.customer.enquiries[0]?.title ?? null,
    });
  }
  return [...seen.values()];
}

// ---------- The profile (M06) ----------

// Who may change a customer's details (M06.07; SOW permission table "Edit customer
// details: own customers / all / all"). History is never editable by anyone.
// Any manager, any branch — customers are shared (BR-16); decided 24 Sep 2026, see
// docs/decisions.md before narrowing it to the manager's branch.
export function canEditCustomer(user: SessionUser, customer: { assignedToId: string }): boolean {
  return user.role !== "SALESPERSON" || customer.assignedToId === user.id;
}

// The number is how everyone finds the customer (BR-01), so only a manager or an admin
// may change it (M06 module prompt).
export function canChangeMobile(user: SessionUser): boolean {
  return user.role !== "SALESPERSON";
}

export type CustomerProfile = {
  id: string;
  name: string;
  mobile: string | null;
  altMobile: string | null;
  area: string | null;
  city: string | null;
  address: string | null;
  occasion: string | null;
  occasionDate: Date | null;
  departmentId: string | null;
  departmentName: string | null;
  assignedToId: string;
  assignedToName: string;
  status: CustomerStatus;
  openEnquiry: {
    title: string;
    latestRemarks: string | null;
    openedAt: Date;
  } | null;
};

// No branch filter (BR-16): anyone who found the customer by mobile may open them.
export async function customerProfile(
  id: string,
  now = new Date(),
): Promise<CustomerProfile | null> {
  const row = await db.customer.findFirst({
    where: { id, active: true },
    select: {
      id: true,
      name: true,
      mobile: true,
      altMobile: true,
      area: true,
      city: true,
      address: true,
      occasion: true,
      occasionDate: true,
      departmentId: true,
      department: { select: { name: true } },
      assignedToId: true,
      assignedTo: { select: { fullName: true } },
      // The newest enquiry decides the status (SOW 6.1: "latest enquiry closed with…").
      enquiries: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { status: true, title: true, latestRemarks: true, openedAt: true },
      },
      // BR-02 allows one pending follow-up per customer.
      followUps: { where: { status: "PENDING" }, take: 1, select: { dueDate: true } },
    },
  });
  if (!row) return null;

  const latest = row.enquiries[0] ?? null;
  const open = latest?.status === "OPEN" ? latest : null;

  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    altMobile: row.altMobile,
    area: row.area,
    city: row.city,
    address: row.address,
    occasion: row.occasion,
    occasionDate: row.occasionDate,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    assignedToId: row.assignedToId,
    assignedToName: row.assignedTo.fullName,
    status: customerStatus({
      latestEnquiry: latest?.status ?? null,
      pendingFollowUpDue: open ? (row.followUps[0]?.dueDate ?? null) : null,
      now,
    }),
    openEnquiry: open
      ? { title: open.title, latestRemarks: open.latestRemarks, openedAt: open.openedAt }
      : null,
  };
}

export const TIMELINE_PAGE = 20;
// Past this the audit log (M16) is the right tool; the profile is for the phone.
export const TIMELINE_MAX = 200;

export type TimelineRow = {
  id: string;
  type: string;
  title: string; // a next-intl key
  detail: string | null;
  staffName: string;
  createdAt: Date;
};

// The newest `take` events, and whether there are older ones. Every event of the
// customer, whichever enquiry it belonged to (M06.06: closed enquiries and earlier
// purchases stay in the history). The id breaks ties so two rows written in the same
// millisecond keep one order from page to page.
export async function customerTimeline(
  customerId: string,
  take: number,
): Promise<{ events: TimelineRow[]; hasMore: boolean }> {
  const rows = await db.timelineEvent.findMany({
    where: { customerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      type: true,
      title: true,
      detail: true,
      createdAt: true,
      staff: { select: { fullName: true } },
    },
  });

  return {
    events: rows.slice(0, take).map(({ staff, ...event }) => ({
      ...event,
      staffName: staff.fullName,
    })),
    hasMore: rows.length > take,
  };
}
