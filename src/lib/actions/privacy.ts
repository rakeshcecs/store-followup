"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { anonymizeCustomer, lastFourMatch, type AnonymizeResult } from "@/lib/privacy";
import { safeAction } from "@/lib/safe-action";
import { deleteCustomerDataInput } from "@/lib/validation/privacy";

// M16.03: "Delete customer data" on the profile, admin only (SOW 3.1, BR-14). Checked
// again inside the transaction, so two admins pressing at once delete once.
export const deleteCustomerData = safeAction({
  name: "deleteCustomerData",
  schema: deleteCustomerDataInput,
  auth: { roles: ["ADMIN"] },
  handler: async ({ customerId, lastFour }, { user }): Promise<AnonymizeResult> => {
    const device = (await headers()).get("user-agent");
    const result = await db.$transaction(async (tx) => {
      // Locks the row: a plain read does not wait under REPEATABLE READ, so both admins
      // saw the customer still there and both "deleted" it.
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
      const customer = await tx.customer.findFirst({
        where: { id: customerId, active: true, anonymizedAt: null },
        select: { id: true, mobile: true, homeBranchId: true },
      });
      if (!customer) throw new AppError("NOT_FOUND");
      if (!lastFourMatch(customer.mobile, lastFour)) {
        throw new AppError("RULE", { message: "privacy.errors.lastFourWrong", field: "lastFour" });
      }
      return anonymizeCustomer(tx, { actor: user, customer, device });
    });

    // Not the whole layout: that re-renders this very page, whose customer is now gone.
    revalidatePath("/customers");
    return result;
  },
});
