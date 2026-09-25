import { z } from "zod";
import { id, requiredText } from "@/lib/validation/common";

// M23: the festival calendar and the occasion follow-up setting. Messages are next-intl
// keys, like every schema the screens share.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "festivals.errors.date");

// "all" is a festival every branch keeps; a branch id is one shop's.
export const festivalBranch = z.union([z.literal("all"), id]);

// ---- festivals (admin) ----

export const festivalInput = z.object({
  name: requiredText(1, 100, "festivals.errors.nameRequired", "festivals.errors.nameTooLong"),
  date: day.pipe(
    z.string().refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), {
      message: "festivals.errors.date",
    }),
  ),
  branch: festivalBranch,
});

export const updateFestivalInput = festivalInput.extend({ id, confirmed: z.boolean() });
export const festivalIdInput = z.object({ id });
export const prefillFestivalsInput = z.object({});

// Settings → Festivals and occasions: the occasion lead days.
export const occasionSettingsInput = z.object({
  occasionLeadDays: z.coerce
    .number("festivals.errors.leadDays")
    .int("festivals.errors.leadDays")
    .min(1, "festivals.errors.leadDays")
    .max(90, "festivals.errors.leadDays"),
});
export type OccasionSettings = z.infer<typeof occasionSettingsInput>;
