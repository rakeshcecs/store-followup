// M15: moving customers from one person to another — the reads the screen needs and the
// one write, shared by the screen's action and the staff-exit path.
//
// branch-scope-exempt: a customer belongs to a person, not a branch (BR-16), and their
// pending follow-ups can sit in any branch (a visit elsewhere files them there, M08.08).
// Handing a book over must move all of it, or the leaver keeps work nobody sees (BR-15).
// Who may do it is checked on the people instead: both must be inside the actor's scope
// (src/lib/actions/reassign.ts).
import type { Prisma, TimeSlot } from "@/generated/prisma/client";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { staffBranchWhere } from "@/lib/staff-scope";
import type { BranchScope } from "@/lib/permissions";
import { reassignDetail, writeTimelineEvent } from "@/lib/timeline";

// What a person still holds: customers assigned to them, or a pending follow-up that is
// theirs on someone else's customer. Both keep them from leaving (staff-work.ts counts
// the same two things).
export function openCustomersWhere(userId: string): Prisma.CustomerWhereInput {
  return {
    active: true,
    OR: [
      { assignedToId: userId },
      { followUps: { some: { assignedToId: userId, status: "PENDING" } } },
    ],
  };
}

export type ReassignRow = {
  id: string;
  name: string;
  mobile: string | null;
  requirement: string | null;
  nextFollowUp: { dueDate: Date; timeSlot: TimeSlot } | null;
  followUps: number; // this person's pending follow-ups on the customer
};

// The "From" list: every customer the person still holds, next follow-up first, then
// those with none, by name.
export async function openCustomersOf(userId: string): Promise<ReassignRow[]> {
  const customers = await db.customer.findMany({
    where: openCustomersWhere(userId),
    select: {
      id: true,
      name: true,
      mobile: true,
      enquiries: {
        where: { status: "OPEN" },
        select: { title: true },
        take: 1,
      },
      followUps: {
        where: { assignedToId: userId, status: "PENDING" },
        select: { dueDate: true, timeSlot: true },
        orderBy: { dueDate: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows = customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    mobile: customer.mobile,
    requirement: customer.enquiries[0]?.title ?? null,
    nextFollowUp: customer.followUps[0] ?? null,
    followUps: customer.followUps.length,
  }));
  const due = (row: ReassignRow) => row.nextFollowUp?.dueDate.getTime() ?? Infinity;
  return rows.sort((a, b) => due(a) - due(b));
}

export type StaffChoice = { id: string; fullName: string; active: boolean; customers: number };

// Whose customers may be moved: anyone in scope who still holds some — an inactive person
// too, so work left behind by an old deactivation can still be handed on.
export async function reassignSources(scope: BranchScope): Promise<StaffChoice[]> {
  const people = await db.user.findMany({
    // AND: both are an OR, and spread side by side the second would replace the branch
    // filter (the bug the staff search had).
    where: {
      AND: [
        staffBranchWhere(scope),
        {
          OR: [
            { assignedCustomers: { some: { active: true } } },
            { assignedFollowUps: { some: { status: "PENDING" } } },
          ],
        },
      ],
    },
    select: { id: true, fullName: true, status: true },
    orderBy: { fullName: "asc" },
  });
  const counts = await Promise.all(
    people.map((person) => db.customer.count({ where: openCustomersWhere(person.id) })),
  );
  return people.map((person, i) => ({
    id: person.id,
    fullName: person.fullName,
    active: person.status === "ACTIVE",
    customers: counts[i] ?? 0,
  }));
}

// Who may receive them: active salespeople only (module prompt).
export function reassignTargets(scope: BranchScope) {
  return db.user.findMany({
    where: { ...staffBranchWhere(scope), role: "SALESPERSON", status: "ACTIVE" },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
}

export type ReassignResult = { customers: number; followUps: number };

// Moves the chosen customers from `from` to `to` inside the caller's transaction:
// - the customer, when it is still `from`'s;
// - its open enquiry, likewise;
// - every PENDING follow-up of `from` on it.
// Visits, done follow-ups and sales keep their salesperson: history and credit stay
// where they were earned (M15). A customer `from` no longer holds (someone moved it in
// the meantime) is skipped, not taken from whoever has it now.
export async function moveCustomers(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    from: { id: string; fullName: string };
    to: { id: string; fullName: string };
    customerIds: string[];
    device: string | null;
  },
): Promise<ReassignResult> {
  const { actorId, from, to } = input;
  const customers = await tx.customer.findMany({
    where: { id: { in: input.customerIds }, ...openCustomersWhere(from.id) },
    select: { id: true, assignedToId: true, homeBranchId: true },
  });

  let followUps = 0;
  for (const customer of customers) {
    const owned = customer.assignedToId === from.id;
    if (owned) {
      await tx.customer.update({
        where: { id: customer.id },
        data: { assignedToId: to.id, updatedById: actorId },
      });
      await tx.enquiry.updateMany({
        where: { customerId: customer.id, status: "OPEN", assignedToId: from.id },
        data: { assignedToId: to.id },
      });
    }
    const moved = await tx.followUp.updateMany({
      where: { customerId: customer.id, assignedToId: from.id, status: "PENDING" },
      data: { assignedToId: to.id },
    });
    followUps += moved.count;

    // "Reassigned from Amit to Priya by [manager]" (M15.03): the names as they were on
    // the day, and the byline is the row's own staff.
    await writeTimelineEvent(tx, {
      customerId: customer.id,
      staffId: actorId,
      kind: "reassigned",
      detail: reassignDetail(from.fullName, to.fullName),
    });
    await writeAudit(tx, {
      userId: actorId,
      branchId: customer.homeBranchId,
      action: AUDIT.customerReassign,
      entityType: "Customer",
      entityId: customer.id,
      oldValue: { assignedToId: owned ? from.id : customer.assignedToId },
      newValue: {
        assignedToId: owned ? to.id : customer.assignedToId,
        followUpsFrom: from.id,
        followUpsTo: to.id,
        followUps: moved.count,
      },
      device: input.device,
    });
  }
  return { customers: customers.length, followUps };
}
