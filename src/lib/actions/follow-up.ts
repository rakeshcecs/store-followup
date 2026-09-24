"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertDueDate, recordFollowUpSet, writeFollowUp } from "@/lib/follow-ups";
import { writeBranchId } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import { setFollowUpInput } from "@/lib/validation/follow-up";

// M08. Setting a follow-up is open to every role (SOW 3.1 "Add … follow-up: Yes"). With a
// visit it goes through recordVisit (BR-04); this is the profile's "Follow-up" (M08.07),
// added to the customer's open enquiry.

// P2002: a unique index said no — this follow-up arrived twice, or someone else set one
// for the same customer at the same moment (pendingCustomerId). P2034: MySQL chose this
// transaction as a deadlock victim in that same race.
const RACE_ATTEMPTS = 3;

function isRace(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error["code"] === "P2002" || error["code"] === "P2034")
  );
}

export const setFollowUp = safeAction({
  name: "setFollowUp",
  schema: setFollowUpInput,
  auth: {},
  handler: async (input, { user }) => {
    // The shop it is set from (BR-16). An admin on "All branches" must pick one.
    const branchId = writeBranchId(user, await getCurrentBranch(user));
    const now = new Date();

    // Sent twice: the same answer, not a second follow-up.
    const saved = async () => {
      const done = await db.followUp.findUnique({
        where: { clientId: input.clientId },
        select: { id: true, customerId: true },
      });
      if (done && done.customerId !== input.customerId) throw new AppError("CONFLICT");
      return done ? { followUpId: done.id } : null;
    };
    const earlier = await saved();
    if (earlier) return earlier;

    // No branch filter: customers are shared across branches (BR-16).
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, active: true },
      select: {
        id: true,
        assignedToId: true,
        enquiries: { where: { status: "OPEN" }, select: { id: true } },
      },
    });
    if (!customer) throw new AppError("NOT_FOUND");
    // A follow-up belongs to an enquiry (SOW 5.6), and an enquiry starts with a visit.
    const enquiry = customer.enquiries[0];
    if (!enquiry) throw new AppError("RULE", { message: "followUps.errors.noOpenEnquiry" });

    assertDueDate(input.followUp.dueDate, now);
    const userDevice = (await headers()).get("user-agent");

    const write = () =>
      db.$transaction(async (tx) => {
        const written = await writeFollowUp(tx, {
          branchId,
          customerId: customer.id,
          enquiryId: enquiry.id,
          assignedToId: customer.assignedToId, // M08.08
          clientId: input.clientId,
          dueDate: input.followUp.dueDate,
          timeSlot: input.followUp.timeSlot,
          method: input.followUp.method,
          reason: input.followUp.reason,
          createdFrom: "PROFILE",
        });
        await recordFollowUpSet(tx, {
          userId: user.id,
          branchId,
          customerId: customer.id,
          device: userDevice,
          written,
        });
        return { followUpId: written.followUp.id };
      });

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await write();
        revalidatePath(`/customers/${customer.id}`);
        return result;
      } catch (error) {
        if (!isRace(error) || attempt === RACE_ATTEMPTS) throw error;
        // This very request, saved by its twin a moment ago…
        const twin = await saved();
        if (twin) return twin;
        // …or another follow-up for the customer won the race. Setting a new one
        // replaces the pending one (M08.06), so try again: this one replaces that one.
      }
    }
  },
});
