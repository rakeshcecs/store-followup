import type { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { webhookSecrets } from "@/lib/whatsapp/settings";
import { handleWebhook, validSignature, type MetaWebhook } from "@/lib/whatsapp/webhook";

export const runtime = "nodejs";

// M22: Meta's webhook. No session — Meta calls it — so it is public in src/proxy.ts and
// proves itself instead: GET with the verify token set in Settings → WhatsApp, POST with
// an X-Hub-Signature-256 made from the app secret. Anything else gets 403.

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const { verifyToken } = await webhookSecrets();
  if (
    params.get("hub.mode") === "subscribe" &&
    verifyToken &&
    params.get("hub.verify_token") === verifyToken
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const { appSecret } = await webhookSecrets();
  if (!appSecret || !validSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response(null, { status: 403 });
  }
  let payload: MetaWebhook;
  try {
    payload = JSON.parse(raw) as MetaWebhook;
  } catch {
    return new Response(null, { status: 400 });
  }
  try {
    await handleWebhook(payload);
  } catch (error) {
    // Meta sends the event again after an error answer; every write is keyed on its id.
    logger.error("whatsapp.webhook_failed", error);
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}
