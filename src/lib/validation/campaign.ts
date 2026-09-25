import { z } from "zod";
import { emptyToUndefined, id, requiredText } from "@/lib/validation/common";
import { CAMPAIGN_FIELDS } from "@/lib/whatsapp/fields";

// M23. Messages are next-intl keys, like every schema the screens share. The filters and
// the variables are stored as JSON on the Campaign, so the same schemas read them back.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "campaigns.errors.date");
const optionalDay = z.preprocess(emptyToUndefined, day.optional());
const optionalId = z.preprocess(emptyToUndefined, id.optional());

// Step 3: who the campaign goes to. Everything optional; nothing set = every customer
// of the branch. A range with only one end is open on the other side.
export const campaignFilters = z
  .object({
    categoryIds: z.array(id).max(50).default([]),
    departmentId: optionalId,
    lastVisitFrom: optionalDay,
    lastVisitTo: optionalDay,
    bought: z.enum(["yes", "no"]).optional(),
    boughtFrom: optionalDay,
    boughtTo: optionalDay,
    lostReasonId: optionalId,
    intent: z.enum(["HOT", "WARM", "COLD"]).optional(),
    occasionWithinDays: z.preprocess(
      emptyToUndefined,
      z.coerce.number("campaigns.errors.occasionDays").int().min(1).max(365).optional(),
    ),
  })
  .refine((f) => !f.lastVisitFrom || !f.lastVisitTo || f.lastVisitFrom <= f.lastVisitTo, {
    message: "campaigns.errors.dateOrder",
    path: ["lastVisitTo"],
  })
  .refine((f) => !f.boughtFrom || !f.boughtTo || f.boughtFrom <= f.boughtTo, {
    message: "campaigns.errors.dateOrder",
    path: ["boughtTo"],
  });
export type CampaignFilters = z.infer<typeof campaignFilters>;

// Step 2: what fills each placeholder — the same text for everyone, or a customer field.
export const campaignVariable = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: requiredText(1, 200, "campaigns.errors.textRequired", "campaigns.errors.textTooLong"),
  }),
  z.object({ kind: z.literal("field"), field: z.enum(CAMPAIGN_FIELDS) }),
]);
export const campaignVariables = z.record(z.string().regex(/^\d{1,2}$/), campaignVariable);

// "all" is the admin's every-branch campaign; a branch id is one shop's.
export const campaignBranch = z.union([z.literal("all"), id]);

const audience = z.object({
  branch: campaignBranch,
  templateId: z
    .string("campaigns.errors.pickTemplate")
    .trim()
    .min(1, "campaigns.errors.pickTemplate"),
  variables: campaignVariables,
  filters: campaignFilters,
});

export const previewCampaignInput = audience;

// ISO instant from the form's datetime-local (the client turns the IST wall time into
// an instant); null = send now.
const scheduledAt = z.preprocess(
  emptyToUndefined,
  z.iso.datetime({ offset: true, error: "campaigns.errors.schedule" }).optional(),
);

export const createCampaignInput = audience.extend({
  name: requiredText(1, 150, "campaigns.errors.nameRequired", "campaigns.errors.nameTooLong"),
  scheduledAt,
});
export type CreateCampaignInput = z.infer<typeof createCampaignInput>;

export const cancelCampaignInput = z.object({ id });

// ---- festivals (admin) ----

export const festivalInput = z.object({
  name: requiredText(1, 100, "festivals.errors.nameRequired", "festivals.errors.nameTooLong"),
  date: day.pipe(
    z.string().refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), {
      message: "campaigns.errors.date",
    }),
  ),
  branch: campaignBranch,
});

export const updateFestivalInput = festivalInput.extend({ id, confirmed: z.boolean() });
export const festivalIdInput = z.object({ id });
export const prefillFestivalsInput = z.object({});

// Settings → Festivals and occasions: the occasion lead days and BR-21's weekly cap.
export const occasionSettingsInput = z.object({
  occasionLeadDays: z.coerce
    .number("festivals.errors.leadDays")
    .int("festivals.errors.leadDays")
    .min(1, "festivals.errors.leadDays")
    .max(90, "festivals.errors.leadDays"),
  campaignWeeklyLimit: z.coerce
    .number("festivals.errors.weeklyLimit")
    .int("festivals.errors.weeklyLimit")
    .min(1, "festivals.errors.weeklyLimit")
    .max(7, "festivals.errors.weeklyLimit"),
});
export type OccasionSettings = z.infer<typeof occasionSettingsInput>;
