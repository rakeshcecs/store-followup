"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { safeAction } from "@/lib/safe-action";
import { billAmountRequired, reminderTimes, SETTING, setSetting } from "@/lib/settings";
import { reminderTimesInput } from "@/lib/validation/reminders";

// Settings → Sales. Admin only: a store-wide rule, not a branch one.

// A ticked checkbox posts "on"; an unticked one posts nothing, which is a real "no".
const salesSettingsInput = z.object({
  billAmountRequired: z.preprocess((value) => value === "on" || value === true, z.boolean()),
});

export const updateSalesSettings = safeAction({
  name: "updateSalesSettings",
  schema: salesSettingsInput,
  auth: { roles: ["ADMIN"] },
  handler: async (input, { user }) => {
    const before = await billAmountRequired();
    if (before === input.billAmountRequired) return { saved: true };

    const device = (await headers()).get("user-agent");
    await db.$transaction(async (tx) => {
      await setSetting(tx, SETTING.billAmountRequired, input.billAmountRequired, user.id);
      await writeAudit(tx, {
        userId: user.id,
        action: AUDIT.settingUpdate,
        entityType: "Setting",
        entityId: SETTING.billAmountRequired,
        oldValue: before,
        newValue: input.billAmountRequired,
        device,
      });
    });

    revalidatePath("/settings/sales");
    return { saved: true };
  },
});

// Settings → Reminders (M14). The worker reads these every minute, so a change applies
// from the next minute without a restart.
export const updateReminderSettings = safeAction({
  name: "updateReminderSettings",
  schema: reminderTimesInput,
  auth: { roles: ["ADMIN"] },
  handler: async (input, { user }) => {
    const before = await reminderTimes();
    if (JSON.stringify(before) === JSON.stringify(input)) return { saved: true };

    const device = (await headers()).get("user-agent");
    await db.$transaction(async (tx) => {
      await setSetting(tx, SETTING.reminderTimes, input, user.id);
      await writeAudit(tx, {
        userId: user.id,
        action: AUDIT.settingUpdate,
        entityType: "Setting",
        entityId: SETTING.reminderTimes,
        oldValue: before,
        newValue: input,
        device,
      });
    });

    revalidatePath("/settings/reminders");
    return { saved: true };
  },
});
