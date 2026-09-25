// The Meta WhatsApp Cloud API (M22): send a template, send free text, list templates.
// Plain fetch — no SDK — so tests stub `fetch` and nothing talks to Meta by accident.
import type { Connection } from "@/lib/whatsapp/settings";

const GRAPH_URL = () => process.env.WHATSAPP_GRAPH_URL || "https://graph.facebook.com";
const GRAPH_VERSION = () => process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
const TIMEOUT_MS = 15_000;

// Meta's error, with whether sending again later can help. Rate limits, Meta's own
// hiccups and 5xx are worth another try; a bad token, a template problem or an
// undeliverable number are not.
export class MetaError extends Error {
  readonly code: string;
  readonly retry: boolean;
  constructor(message: string, code: string, retry: boolean) {
    super(message);
    this.name = "MetaError";
    this.code = code;
    this.retry = retry;
  }
}

const RETRY_CODES = new Set([
  "1",
  "2",
  "4",
  "17",
  "32",
  "613",
  "80007",
  "130429",
  "131000",
  "131016",
  "131056",
]);

export function isRetryable(code: string, httpStatus: number): boolean {
  return httpStatus >= 500 || httpStatus === 429 || RETRY_CODES.has(code);
}

// Indian numbers as Meta wants them: country code, no plus.
export function metaNumber(mobile: string): string {
  return `91${mobile}`;
}

// "919825012345" (Meta's wa_id) back to the app's 10 digits, or null.
export function appNumber(waId: string): string | null {
  const digits = waId.replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

async function call<T>(
  connection: Pick<Connection, "accessToken">,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${GRAPH_URL()}/${GRAPH_VERSION()}/${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // No answer at all: the network, a timeout. Worth another try.
    throw new MetaError(error instanceof Error ? error.message : "network", "network", true);
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: {
      message?: string;
      code?: number;
      error_subcode?: number;
      error_data?: { details?: string };
    };
  } & T;
  if (!response.ok || body.error) {
    const code = String(body.error?.code ?? response.status);
    const message =
      body.error?.error_data?.details || body.error?.message || `HTTP ${response.status}`;
    throw new MetaError(message.slice(0, 500), code, isRetryable(code, response.status));
  }
  return body;
}

type SendAnswer = { messages?: { id: string }[] };

function messageId(answer: SendAnswer): string {
  const id = answer.messages?.[0]?.id;
  if (!id) throw new MetaError("no message id in Meta's answer", "no-id", true);
  return id;
}

export async function sendTemplateMessage(
  connection: Connection,
  input: { to: string; name: string; language: string; parameters: string[] },
): Promise<string> {
  const answer = await call<SendAnswer>(connection, `${connection.phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      to: metaNumber(input.to),
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        ...(input.parameters.length > 0
          ? {
              components: [
                {
                  type: "body",
                  parameters: input.parameters.map((text) => ({ type: "text", text })),
                },
              ],
            }
          : {}),
      },
    },
  });
  return messageId(answer);
}

export async function sendTextMessage(
  connection: Connection,
  input: { to: string; body: string },
): Promise<string> {
  const answer = await call<SendAnswer>(connection, `${connection.phoneNumberId}/messages`, {
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      to: metaNumber(input.to),
      type: "text",
      text: { body: input.body, preview_url: false },
    },
  });
  return messageId(answer);
}

export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: { type: string; text?: string; format?: string }[];
};

// Every template of the business account, following Meta's paging.
export async function listTemplates(connection: Connection): Promise<MetaTemplate[]> {
  const all: MetaTemplate[] = [];
  let path: string | null =
    `${connection.wabaId}/message_templates?fields=id,name,language,status,category,components&limit=100`;
  for (let page = 0; path && page < 20; page++) {
    const answer: { data?: MetaTemplate[]; paging?: { next?: string } } = await call(
      connection,
      path,
    );
    all.push(...(answer.data ?? []));
    const next = answer.paging?.next;
    path = next ? next.slice(next.indexOf(GRAPH_VERSION()) + GRAPH_VERSION().length + 1) : null;
  }
  return all;
}
