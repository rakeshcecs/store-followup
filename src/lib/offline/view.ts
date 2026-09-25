// M19: what the offline screens show — the cached copy with everything saved on the
// phone since laid over it, in the order it was saved. Pure, so it is tested without a
// browser: a customer added offline can be found by number, a follow-up updated offline
// leaves the Today list, and a new one joins it.
import { addDays } from "@/lib/follow-up-dates";
import { isoDate } from "@/lib/format";
import { normalizeMobile } from "@/lib/mobile";
import type {
  CachedCustomer,
  CachedFollowUp,
  Method,
  OfflineCache,
  OutboxEntry,
  Slot,
} from "@/lib/offline/types";
import { enquiryTitle } from "@/lib/visits";

type Input = Record<string, unknown>;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export type OfflineView = {
  customers: Map<string, CachedCustomer>;
  followUps: CachedFollowUp[]; // this person's pending ones, oldest due first
};

const SLOT_ORDER: Record<Slot, number> = { MORNING: 0, AFTERNOON: 1, EVENING: 2 };

export function offlineView(
  cache: OfflineCache,
  outbox: OutboxEntry[],
  today: string,
): OfflineView {
  const customers = new Map(cache.customers.map((customer) => [customer.id, { ...customer }]));
  let followUps = cache.followUps.map((followUp) => ({ ...followUp }));
  const categoryName = new Map(cache.lists.categories.map((item) => [item.id, item.name]));
  const staffName = new Map(cache.lists.staff.map((item) => [item.id, item.name]));

  // A new pending follow-up for the customer replaces any other (M08.06, BR-02), and
  // it is on this person's list only when it is theirs.
  function setPending(
    customer: CachedCustomer,
    followUp: {
      id: string;
      dueDate: string;
      timeSlot: Slot;
      method: Method;
      reason: string | null;
    },
    notReachableCount = 0,
  ) {
    followUps = followUps.filter((row) => row.customerId !== customer.id);
    customer.pending = {
      id: followUp.id,
      dueDate: followUp.dueDate,
      timeSlot: followUp.timeSlot,
      assignedToId: customer.assignedToId,
    };
    if (customer.assignedToId === cache.user.id) {
      followUps.push({
        ...followUp,
        customerId: customer.id,
        customerName: customer.name,
        mobile: customer.mobile,
        enquiryTitle: customer.openEnquiryTitle ?? "",
        notReachableCount,
      });
    }
  }

  // A sale or "not interested" closes the enquiry and cancels what was pending (BR-05, BR-06).
  function close(customer: CachedCustomer) {
    customer.openEnquiryTitle = null;
    customer.pending = null;
    followUps = followUps.filter((row) => row.customerId !== customer.id);
  }

  for (const entry of outbox) {
    const input = entry.input as Input;
    switch (entry.kind) {
      case "customer": {
        const assignedToId = String(input["assignedToId"] ?? "");
        customers.set(entry.id, {
          id: entry.id,
          name: String(input["name"] ?? ""),
          mobile: normalizeMobile(input["mobile"]) ?? String(input["mobile"] ?? ""),
          altMobile: normalizeMobile(input["altMobile"]),
          area: text(input["area"]),
          city: text(input["city"]),
          assignedToId,
          assignedToName: staffName.get(assignedToId) ?? "",
          openEnquiryTitle: null,
          pending: null,
        });
        break;
      }
      case "visit": {
        const customer = customers.get(String(input["customerId"]));
        if (!customer) break;
        const outcome = input["outcome"];
        if (outcome === "PURCHASED" || outcome === "NOT_INTERESTED") {
          close(customer);
          break;
        }
        const ids = Array.isArray(input["categoryIds"]) ? (input["categoryIds"] as string[]) : [];
        customer.openEnquiryTitle ??= enquiryTitle(
          ids.map((id) => categoryName.get(id) ?? "").filter(Boolean),
        );
        const followUp = (input["followUp"] ?? {}) as Input;
        setPending(customer, {
          id: String(followUp["clientId"] ?? entry.id),
          dueDate: String(followUp["dueDate"]),
          timeSlot: followUp["timeSlot"] as Slot,
          method: followUp["method"] as Method,
          reason: text(followUp["reason"]),
        });
        break;
      }
      case "followUp": {
        const customer = customers.get(String(input["customerId"]));
        if (!customer) break;
        const followUp = (input["followUp"] ?? {}) as Input;
        setPending(customer, {
          id: entry.id,
          dueDate: String(followUp["dueDate"]),
          timeSlot: followUp["timeSlot"] as Slot,
          method: followUp["method"] as Method,
          reason: text(followUp["reason"]),
        });
        break;
      }
      case "sale": {
        const customer = customers.get(String(input["customerId"]));
        if (customer) close(customer);
        break;
      }
      case "result": {
        const id = String(input["id"]);
        const previous = followUps.find((row) => row.id === id);
        const customer = [...customers.values()].find((row) => row.pending?.id === id);
        followUps = followUps.filter((row) => row.id !== id);
        if (!customer) break;
        const result = input["result"];
        if (result === "NOT_INTERESTED") {
          close(customer);
          break;
        }
        const slot = customer.pending?.timeSlot ?? previous?.timeSlot ?? "EVENING";
        const next =
          result === "NOT_REACHABLE" ? addDays(isoDate(entry.at), 1) : text(input["nextDate"]);
        if (!next) break;
        setPending(
          customer,
          {
            id: String(input["clientId"] ?? entry.id),
            dueDate: next,
            timeSlot: slot,
            method:
              result === "WILL_VISIT"
                ? "VISIT"
                : result === "CALL_LATER"
                  ? "CALL"
                  : (previous?.method ?? "CALL"),
            reason: previous?.reason ?? null,
          },
          result === "NOT_REACHABLE" ? (previous?.notReachableCount ?? 0) + 1 : 0,
        );
        break;
      }
    }
  }

  followUps.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || SLOT_ORDER[a.timeSlot] - SLOT_ORDER[b.timeSlot],
  );
  // The Today screen's reach: overdue, today, and the next 7 days (M11.07).
  const horizon = addDays(today, 7);
  return { customers, followUps: followUps.filter((row) => row.dueDate <= horizon) };
}

// "Search by mobile": the main or the alternate number, typed any way (M05.04).
export function findByMobile(view: OfflineView, value: string): CachedCustomer | null {
  const mobile = normalizeMobile(value);
  if (!mobile) return null;
  for (const customer of view.customers.values()) {
    if (customer.mobile === mobile || customer.altMobile === mobile) return customer;
  }
  return null;
}

export type TodayBuckets = {
  overdue: CachedFollowUp[];
  dueToday: CachedFollowUp[];
  comingUp: CachedFollowUp[];
};

export function todayBuckets(followUps: CachedFollowUp[], today: string): TodayBuckets {
  return {
    overdue: followUps.filter((row) => row.dueDate < today),
    dueToday: followUps.filter((row) => row.dueDate === today),
    comingUp: followUps.filter((row) => row.dueDate > today),
  };
}

// The ids an entry gives to what it makes: its own, and the follow-up or sale that
// comes with a visit.
function madeBy(entry: OutboxEntry): string[] {
  const input = entry.input as Input;
  const nested = (key: string) => (input[key] as Input | undefined)?.["clientId"];
  return [entry.id, nested("followUp"), nested("sale")].filter(
    (id): id is string => typeof id === "string",
  );
}

function refersTo(entry: OutboxEntry): string[] {
  const input = entry.input as Input;
  return ["customerId", "followUpId", ...(entry.kind === "result" ? ["id"] : [])]
    .map((key) => input[key])
    .filter((id): id is string => typeof id === "string");
}

// Everything that cannot be sent without this entry: a visit for a customer added
// offline, the update of a follow-up set offline — and what depends on those in turn.
export function dependentsOf(outbox: OutboxEntry[], id: string): OutboxEntry[] {
  const start = outbox.find((entry) => entry.id === id);
  if (!start) return [];
  const gone = new Set(madeBy(start));
  const found: OutboxEntry[] = [];
  for (const entry of outbox) {
    if (entry.id === id) continue;
    if (refersTo(entry).some((ref) => gone.has(ref))) {
      found.push(entry);
      for (const made of madeBy(entry)) gone.add(made);
    }
  }
  return found;
}
