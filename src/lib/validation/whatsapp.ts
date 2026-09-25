import { z } from "zod";
import { emptyToUndefined, id, requiredText } from "@/lib/validation/common";
import { TEMPLATE_FIELDS } from "@/lib/whatsapp/fields";

// M22. Messages are next-intl keys, like every schema the screens share.

export const sendTemplateInput = z.object({
  customerId: id,
  templateId: z
    .string("whatsapp.errors.pickTemplate")
    .trim()
    .min(1, "whatsapp.errors.pickTemplate"),
});

export const sendTextInput = z.object({
  customerId: id,
  text: requiredText(1, 1000, "whatsapp.errors.textRequired", "whatsapp.errors.textTooLong"),
});

// The person ticks that the customer agreed (M22: "with confirmation").
export const recordConsentInput = z.object({
  customerId: id,
  confirmed: z.literal(true, "whatsapp.errors.confirmConsent"),
});

const metaId = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{5,30}$/, message);
const secret = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

// Secrets left blank keep the saved ones (the form never shows them).
export const connectionInput = z.object({
  phoneNumberId: metaId("whatsapp.errors.phoneNumberId"),
  wabaId: metaId("whatsapp.errors.wabaId"),
  accessToken: secret(1000),
  appSecret: secret(200),
  verifyToken: secret(200),
});

export const testMessageInput = z.object({
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "customers.errors.mobileInvalid"),
});

export const templateMappingInput = z.object({
  templateId: id,
  mapping: z.record(z.string().regex(/^\d{1,2}$/), z.enum(TEMPLATE_FIELDS)),
});

const automaticItem = z.object({
  enabled: z.boolean(),
  templateId: z.preprocess(emptyToUndefined, id.optional()),
});
export const automaticInput = z.object({
  thankYou: automaticItem,
  visitReminder: automaticItem,
  occasion: automaticItem,
});

export const unknownHandledInput = z.object({ id });
