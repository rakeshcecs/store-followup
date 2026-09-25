// M10 Sale completed, shared by the Server Action and the offline sync (M19).
import { revalidatePath } from "next/cache";
import { AUDIT, writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { completeFollowUp, followUpAccessWhere } from "@/lib/follow-ups";
import { writeBranchId } from "@/lib/permissions";
import {
  assertBillAmount,
  assertBillDate,
  assertBillFree,
  billTakenError,
  writeSale,
} from "@/lib/sales";
import { billAmountRequired } from "@/lib/settings";
import { FOLLOW_UP_CALL_TITLE, writeTimelineEvent } from "@/lib/timeline";
import type { RecordSaleInput } from "@/lib/validation/sale";
import { isUniqueViolation, type WriteContext } from "@/lib/writes/context";

// A sale on its own — "Sale done" on the profile — added to the customer's open enquiry.
// With no open enquiry the purchase is a visit, recorded through Record visit (BR-03).
// From Update follow-up's "Customer already bought" (M09.07) it also names the follow-up:
// that one is marked Done only now, with the sale, and becomes its linked follow-up.
export async function recordSaleCore(
  input: RecordSaleInput,
  user: SessionUser,
  ctx: WriteContext,
): Promise<{ saleId: string; billNumber: string }> {
  const branchId = writeBranchId(user, ctx.branch);
  const now = ctx.now;

  // Sent twice: the same answer, not a second sale.
  const done = await db.sale.findUnique({
    where: { clientId: input.clientId },
    select: { id: true, customerId: true, billNumber: true },
  });
  if (done) {
    if (done.customerId !== input.customerId) throw new AppError("CONFLICT");
    return { saleId: done.id, billNumber: done.billNumber };
  }

  // No branch filter: customers are shared across branches (BR-16).
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, active: true },
    select: { id: true, enquiries: { where: { status: "OPEN" }, select: { id: true } } },
  });
  if (!customer) throw new AppError("NOT_FOUND");
  const enquiry = customer.enquiries[0];
  if (!enquiry) throw new AppError("RULE", { message: "sales.errors.noOpenEnquiry" });

  // The same rule as Update follow-up: the person who may record its result (M09).
  const followUp = input.followUpId
    ? await db.followUp.findFirst({
        where: { id: input.followUpId, customerId: customer.id, ...followUpAccessWhere(user) },
        select: { id: true, branchId: true, status: true },
      })
    : null;
  if (input.followUpId && !followUp) throw new AppError("NOT_FOUND");
  if (followUp && followUp.status !== "PENDING") {
    throw new AppError("RULE", { message: "followUpResult.errors.alreadyUpdated" });
  }

  assertBillDate(input.sale.billDate, now);
  assertBillAmount(input.sale.billAmount, await billAmountRequired());
  await assertBillFree(branchId, input.sale.billNumber, user.language);
  const userDevice = ctx.device;

  try {
    const sale = await db.$transaction(async (tx) => {
      // Done before the sale is written, so writeSale links it as "the last completed
      // follow-up of the enquiry" (SOW 5.7) and the sale counts as a conversion (BR-11).
      if (followUp) {
        await completeFollowUp(tx, {
          id: followUp.id,
          result: "ALREADY_BOUGHT",
          note: input.followUpNote,
          userId: user.id,
          now,
        });
        await writeAudit(tx, {
          userId: user.id,
          branchId: followUp.branchId,
          action: AUDIT.followUpResult,
          entityType: "FollowUp",
          entityId: followUp.id,
          oldValue: { status: "PENDING" },
          newValue: {
            status: "DONE",
            result: "ALREADY_BOUGHT",
            note: input.followUpNote ?? null,
          },
          device: userDevice,
        });
        await writeTimelineEvent(tx, {
          customerId: customer.id,
          staffId: user.id,
          branchId: followUp.branchId,
          kind: "followUpResult",
          title: FOLLOW_UP_CALL_TITLE.ALREADY_BOUGHT,
          detail: input.followUpNote,
          entityId: followUp.id,
        });
      }
      const created = await writeSale(tx, {
        branchId,
        customerId: customer.id,
        enquiryId: enquiry.id,
        salespersonId: user.id,
        clientId: input.clientId,
        billNumber: input.sale.billNumber,
        billDate: input.sale.billDate,
        billAmount: input.sale.billAmount,
        remarks: input.sale.remarks,
        enteredOffline: ctx.offline,
        userId: user.id,
        device: userDevice,
        now,
      });
      await writeTimelineEvent(tx, {
        customerId: customer.id,
        staffId: user.id,
        branchId,
        kind: "saleCompleted",
        detail: created.billNumber,
        entityId: created.id,
      });
      await writeAudit(tx, {
        userId: user.id,
        branchId,
        action: AUDIT.saleCreate,
        entityType: "Sale",
        entityId: created.id,
        newValue: created,
        device: userDevice,
      });
      return created;
    });

    revalidatePath(`/customers/${customer.id}`);
    return { saleId: sale.id, billNumber: sale.billNumber };
  } catch (error) {
    // This very sale sent twice at once (a double tap, or Background Sync beside the app's
    // own sync): the twin that won holds our clientId, so answer as if we had saved it —
    // not "bill already used" or "follow-up already updated" about our own sale.
    const twin = await db.sale.findUnique({
      where: { clientId: input.clientId },
      select: { id: true, customerId: true, billNumber: true },
    });
    if (twin?.customerId === customer.id) return { saleId: twin.id, billNumber: twin.billNumber };
    // Two people saving the same bill at the same moment: the unique index lets one
    // through, and the other gets the message the check above would have given.
    if (isUniqueViolation(error)) {
      throw await billTakenError(branchId, input.sale.billNumber, user.language);
    }
    throw error;
  }
}
