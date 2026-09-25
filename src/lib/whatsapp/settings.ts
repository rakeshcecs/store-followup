// M22 settings, in the `settings` table like every other store setting. The connection's
// secrets are stored sealed (src/lib/secret-box.ts) and never leave the server: the admin
// screen only learns whether each one is set.
//
// audit-exempt: saveConnection / saveAutomatic write through setSetting(), called only from
// src/lib/actions/whatsapp.ts, which writes the "setting:update" row (without the secrets).
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { seal, unseal } from "@/lib/secret-box";
import { setSetting } from "@/lib/settings";

export const WHATSAPP_SETTING = {
  connection: "whatsapp:connection",
  automatic: "whatsapp:automatic",
} as const;

export type Connection = {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
};

const storedConnection = z.object({
  phoneNumberId: z.string().default(""),
  wabaId: z.string().default(""),
  accessToken: z.string().nullable().default(null), // sealed
  appSecret: z.string().nullable().default(null), // sealed
  verifyToken: z.string().nullable().default(null), // sealed
});
type StoredConnection = z.infer<typeof storedConnection>;

async function readStored(): Promise<StoredConnection> {
  const row = await db.setting.findUnique({
    where: { key: WHATSAPP_SETTING.connection },
    select: { value: true },
  });
  const parsed = storedConnection.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : storedConnection.parse({});
}

// Everything needed to call Meta, or null while any part is missing.
export async function whatsappConnection(): Promise<Connection | null> {
  const stored = await readStored();
  const accessToken = unseal(stored.accessToken);
  const appSecret = unseal(stored.appSecret);
  const verifyToken = unseal(stored.verifyToken);
  if (!stored.phoneNumberId || !stored.wabaId || !accessToken || !appSecret || !verifyToken) {
    return null;
  }
  return {
    phoneNumberId: stored.phoneNumberId,
    wabaId: stored.wabaId,
    accessToken,
    appSecret,
    verifyToken,
  };
}

// The webhook needs only these two; it must answer even while sending is not set up.
export async function webhookSecrets(): Promise<{
  appSecret: string | null;
  verifyToken: string | null;
}> {
  const stored = await readStored();
  return { appSecret: unseal(stored.appSecret), verifyToken: unseal(stored.verifyToken) };
}

export type ConnectionSummary = {
  phoneNumberId: string;
  wabaId: string;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
};

export async function connectionSummary(): Promise<ConnectionSummary> {
  const stored = await readStored();
  return {
    phoneNumberId: stored.phoneNumberId,
    wabaId: stored.wabaId,
    hasAccessToken: unseal(stored.accessToken) !== null,
    hasAppSecret: unseal(stored.appSecret) !== null,
    hasVerifyToken: unseal(stored.verifyToken) !== null,
  };
}

// A blank secret keeps the one already saved: the form never shows them, so an admin who
// changes only the phone number ID must not wipe the token.
export async function saveConnection(
  tx: Prisma.TransactionClient,
  input: {
    phoneNumberId: string;
    wabaId: string;
    accessToken?: string;
    appSecret?: string;
    verifyToken?: string;
  },
  userId: string,
): Promise<void> {
  const stored = await readStored();
  const value: StoredConnection = {
    phoneNumberId: input.phoneNumberId,
    wabaId: input.wabaId,
    accessToken: input.accessToken ? seal(input.accessToken) : stored.accessToken,
    appSecret: input.appSecret ? seal(input.appSecret) : stored.appSecret,
    verifyToken: input.verifyToken ? seal(input.verifyToken) : stored.verifyToken,
  };
  await setSetting(tx, WHATSAPP_SETTING.connection, value, userId);
}

// ---- automatic messages ----

export const AUTOMATIC = ["thankYou", "visitReminder", "occasion"] as const;
export type AutomaticKind = (typeof AUTOMATIC)[number];

const automaticItem = z.object({
  enabled: z.boolean().default(false),
  templateId: z.string().max(40).nullable().default(null),
});
export const automaticSettings = z.object({
  thankYou: automaticItem.default({ enabled: false, templateId: null }),
  visitReminder: automaticItem.default({ enabled: false, templateId: null }),
  occasion: automaticItem.default({ enabled: false, templateId: null }),
});
export type AutomaticSettings = z.infer<typeof automaticSettings>;

// Off until the admin switches each one on and picks its template.
export async function automaticWhatsApp(): Promise<AutomaticSettings> {
  const row = await db.setting.findUnique({
    where: { key: WHATSAPP_SETTING.automatic },
    select: { value: true },
  });
  const parsed = automaticSettings.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : automaticSettings.parse({});
}

export async function saveAutomatic(
  tx: Prisma.TransactionClient,
  value: AutomaticSettings,
  userId: string,
): Promise<void> {
  await setSetting(tx, WHATSAPP_SETTING.automatic, value, userId);
}
