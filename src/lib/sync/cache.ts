// M19: what the phone keeps for working without internet. The customers this person
// handled in the last 90 days plus today's follow-up customers (search by mobile), their
// follow-up list (the Today screen), and the short lists the forms offer. Stored on the
// phone encrypted (src/lib/offline/), and replaced on every refresh.
//
// branch-scope-exempt: the follow-up list is loadToday()'s — a salesperson's own
// follow-ups in every branch they work in (followUpAccessWhere) — and a customer's
// pending follow-up is looked up store-wide, as BR-02 allows one per customer.
import { createHash } from "node:crypto";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";
import { activeCategories, activeLostReasons } from "@/lib/master-lists";
import { ALL_BRANCHES, type BranchChoice } from "@/lib/permissions";
import { billAmountRequired } from "@/lib/settings";
import { staffBranchWhere } from "@/lib/staff-scope";
import { loadToday } from "@/lib/today";
import type { OfflineCache } from "@/lib/offline/types";

export const CACHE_DAYS = 90;
// A ceiling, not a target: a salesperson handles a few hundred customers in 90 days.
export const CACHE_MAX_CUSTOMERS = 3000;

// The key the phone encrypts with belongs to the session: made from the session token,
// which only the server and the httpOnly cookie ever see. A new login is a new key, and
// the phone throws away anything kept under the old one.
export function offlineKey(sessionToken: string): { key: string; keyId: string } {
  const raw = createHash("sha256").update(`m19-offline-key:${sessionToken}`).digest();
  return {
    key: raw.toString("base64"),
    keyId: createHash("sha256").update(raw).digest("hex").slice(0, 16),
  };
}

export async function loadOfflineCache(
  user: SessionUser,
  branch: BranchChoice,
  now: Date,
): Promise<OfflineCache> {
  const today = isoDate(now);
  const since = calendarDay(addDays(today, -CACHE_DAYS));
  const branchId = branch === ALL_BRANCHES ? null : branch;
  const locale = user.language;

  const [me, todayData, branchRow, categories, reasons, departments, staff, amountRequired] =
    await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true } }),
      loadToday(user, now),
      branchId
        ? db.branch.findUnique({
            where: { id: branchId },
            select: { id: true, name: true, city: true },
          })
        : null,
      branchId ? activeCategories({ all: false, branchIds: [branchId] }, locale) : [],
      activeLostReasons(locale),
      db.department.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      branchId
        ? db.user.findMany({
            where: { status: "ACTIVE", ...staffBranchWhere({ all: false, branchIds: [branchId] }) },
            orderBy: { fullName: "asc" },
            select: { id: true, fullName: true },
          })
        : [],
      billAmountRequired(),
    ]);

  const followUps = [...todayData.overdue, ...todayData.dueToday, ...todayData.comingUp];
  const followUpCustomers = followUps.map((row) => row.customer.id);

  // Customers are shared across branches (BR-16), so no branch filter: "handled by this
  // person" is what decides.
  const customers = await db.customer.findMany({
    where: {
      active: true,
      OR: [
        { id: { in: followUpCustomers } },
        { assignedToId: user.id, updatedAt: { gte: since } },
        { createdById: user.id, createdAt: { gte: since } },
        { visits: { some: { salespersonId: user.id, visitAt: { gte: since } } } },
        { sales: { some: { salespersonId: user.id, createdAt: { gte: since } } } },
        { followUps: { some: { assignedToId: user.id, createdAt: { gte: since } } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: CACHE_MAX_CUSTOMERS,
    select: {
      id: true,
      name: true,
      mobile: true,
      altMobile: true,
      area: true,
      city: true,
      assignedToId: true,
      assignedTo: { select: { fullName: true } },
      enquiries: { where: { status: "OPEN" }, select: { title: true } },
      followUps: {
        where: { status: "PENDING" },
        select: { id: true, dueDate: true, timeSlot: true, assignedToId: true },
      },
    },
  });

  return {
    version: 1,
    savedAt: now.toISOString(),
    today,
    user: { id: user.id, name: me.fullName, role: user.role, language: user.language },
    branch: branchRow
      ? { id: branchRow.id, name: branchRow.name, city: branchRow.city ?? "" }
      : null,
    lists: {
      categories: categories.map(({ id, name }) => ({ id, name })),
      reasons: reasons.map(({ id, name }) => ({ id, name })),
      departments,
      staff: staff.map((person) => ({ id: person.id, name: person.fullName })),
      billAmountRequired: amountRequired,
    },
    customers: customers.flatMap((customer) =>
      // A privacy-deleted customer has no number to search by.
      customer.mobile
        ? [
            {
              id: customer.id,
              name: customer.name,
              mobile: customer.mobile,
              altMobile: customer.altMobile,
              area: customer.area,
              city: customer.city,
              assignedToId: customer.assignedToId,
              assignedToName: customer.assignedTo.fullName,
              openEnquiryTitle: customer.enquiries[0]?.title ?? null,
              pending: customer.followUps[0]
                ? {
                    id: customer.followUps[0].id,
                    dueDate: isoDate(customer.followUps[0].dueDate),
                    timeSlot: customer.followUps[0].timeSlot,
                    assignedToId: customer.followUps[0].assignedToId,
                  }
                : null,
            },
          ]
        : [],
    ),
    followUps: followUps.map((row) => ({
      id: row.id,
      customerId: row.customer.id,
      customerName: row.customer.name,
      mobile: row.customer.mobile,
      enquiryTitle: row.enquiry.title,
      dueDate: isoDate(row.dueDate),
      timeSlot: row.timeSlot,
      method: row.method,
      reason: row.reason,
      notReachableCount: row.notReachableCount,
    })),
    overdueCount: todayData.counts.overdue,
  };
}
