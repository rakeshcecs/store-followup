// Writing sales (M07 with a visit; M10 draws its own screen and reuses this).
//
// branch-scope-exempt: bill numbers are unique within the branch the sale is written to
// (BR-07), and that branch comes from writeBranchId() in the caller; the linked
// follow-up is the enquiry's own, whichever branch it was set in.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Locale } from "@/i18n/config";
import { formatDate, isoDate } from "@/lib/format";
import { calendarDay, cancelPendingFollowUps } from "@/lib/follow-ups";

// BR-08: a bill date is today or earlier — today in the shop, i.e. IST.
export function assertBillDate(billDate: string, now: Date): void {
  if (billDate > isoDate(now)) {
    throw new AppError("RULE", { message: "visits.errors.billDateFuture", field: "sale.billDate" });
  }
}

// M10.02: "This bill number is already saved for [Customer name] ([date])". The date is
// formatted here, in the reader's language, because a message value is plain text.
function billTaken(row: { billDate: Date; customer: { name: string } }, locale: Locale): AppError {
  return new AppError("CONFLICT", {
    message: "visits.errors.billTaken",
    field: "sale.billNumber",
    values: { name: row.customer.name, date: formatDate(row.billDate, locale) },
  });
}

// Who already has this bill number in the branch — cancelled sales included, since the
// unique index counts them too (M10 module prompt).
export async function billOwner(branchId: string, billNumber: string) {
  return db.sale.findFirst({
    where: { branchId, billNumber },
    select: { billDate: true, customer: { select: { name: true } } },
  });
}

// BR-07, checked before the transaction so the common case gets the good message; the
// unique index (branchId, billNumber) is the real guard, see billTakenError() below.
export async function assertBillFree(
  branchId: string,
  billNumber: string,
  locale: Locale,
): Promise<void> {
  const existing = await billOwner(branchId, billNumber);
  if (existing) throw billTaken(existing, locale);
}

// After a P2002 on the sale insert: the same answer the check above would have given.
export async function billTakenError(
  branchId: string,
  billNumber: string,
  locale: Locale,
): Promise<AppError> {
  const existing = await billOwner(branchId, billNumber);
  return existing ? billTaken(existing, locale) : new AppError("CONFLICT");
}

// SOW Open point #1: required unless the admin switched it off (src/lib/settings.ts).
export function assertBillAmount(amount: number | undefined, required: boolean): void {
  if (required && amount === undefined) {
    throw new AppError("VALIDATION", {
      message: "visits.errors.billAmountRequired",
      field: "sale.billAmount",
    });
  }
}

export type NewSale = {
  branchId: string;
  customerId: string;
  enquiryId: string;
  salespersonId: string; // gets the credit (SOW 5.7)
  clientId?: string;
  billNumber: string; // already trimmed and in capitals by the schema
  billDate: string;
  billAmount?: number;
  remarks?: string;
};

// Saves the sale and closes what it ends (BR-06): the enquiry becomes Sale Completed and
// any pending follow-up is cancelled.
export async function writeSale(tx: Prisma.TransactionClient, input: NewSale) {
  // "Linked follow-up: last completed follow-up of the enquiry" (SOW 5.7); a sale that
  // had one counts as a follow-up conversion (BR-11).
  const linked = await tx.followUp.findFirst({
    where: { enquiryId: input.enquiryId, status: "DONE" },
    orderBy: { completedAt: "desc" },
    select: { id: true },
  });

  const sale = await tx.sale.create({
    data: {
      branchId: input.branchId,
      customerId: input.customerId,
      enquiryId: input.enquiryId,
      salespersonId: input.salespersonId,
      clientId: input.clientId ?? randomUUID(),
      billNumber: input.billNumber,
      billDate: calendarDay(input.billDate),
      billAmount: input.billAmount ?? null,
      remarks: input.remarks ?? null,
      linkedFollowUpId: linked?.id ?? null,
      fromFollowUp: linked !== null,
    },
    select: { id: true, billNumber: true, billDate: true, billAmount: true },
  });

  await tx.enquiry.update({
    where: { id: input.enquiryId },
    data: { status: "SALE_COMPLETED", closedAt: new Date() },
  });
  await cancelPendingFollowUps(tx, input.customerId);

  return sale;
}
