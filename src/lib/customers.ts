// Reading customers (M05). M06's profile and M07's visit screen call the same helpers.
//
// Nothing here filters by branch, on purpose: customers are shared across branches
// (BR-16), and the whole point of searching by mobile is that anyone can find anyone
// before creating a second row for the same person (BR-01). Visits, follow-ups and
// sales are the branch-scoped part, and they arrive in M07 onwards.
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
