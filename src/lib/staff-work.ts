// What still points at a staff member. Separate from the actions file because that one
// is a "use server" module, where every export becomes a callable endpoint — and this
// takes a transaction client, which cannot cross that boundary.
//
// M15 turns these counts into the reassign screen; until then they are the reason
// deactivating a salesperson is refused (BR-15).
//
// branch-scope-exempt: a salesperson's pending follow-ups can sit in any branch (a visit
// elsewhere files them there, M08.08), and every one must be handed over before they
// leave — so this counts across branches. Only a number comes back, never a row.
import type { Prisma } from "@/generated/prisma/client";

export type OpenWork = { customers: number; followUps: number };

export async function openWorkFor(db: Prisma.TransactionClient, userId: string): Promise<OpenWork> {
  const [customers, followUps] = await Promise.all([
    db.customer.count({ where: { assignedToId: userId, active: true } }),
    db.followUp.count({ where: { assignedToId: userId, status: "PENDING" } }),
  ]);
  return { customers, followUps };
}

export function hasOpenWork(work: OpenWork): boolean {
  return work.customers > 0 || work.followUps > 0;
}
