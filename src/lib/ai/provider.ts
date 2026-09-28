// The one place that talks to the AI service (M20, M21). Everything else works with the
// three calls below, so moving to another provider later means changing this file only.
//
// OpenAI over plain fetch: one forced tool call for the form, one multipart upload for
// speech, and a streamed conversation with read-only tools for questions (M21). No SDK —
// three endpoints do not need one, and the request shapes are small.
import { logger } from "@/lib/logger";

export const AI_FILL_TIMEOUT_MS = 8_000; // module prompt; the SOW target is 5 s
export const AI_TRANSCRIBE_TIMEOUT_MS = 20_000; // up to 60 s of audio to upload and decode

const DEFAULT_MODEL = "gpt-4.1-mini"; // fast tool calling, no thinking delay
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"; // Hindi, Gujarati, English
const BASE_URL = "https://api.openai.com/v1";

// A tool the model must call: the JSON Schema of its one argument object.
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type FillRequest = {
  system: string;
  user: string;
  tool: ToolDefinition;
  timeoutMs?: number;
};

export type TranscribeRequest = {
  audio: Blob;
  fileName: string;
  language: "en" | "hi" | "gu"; // a hint; mixed speech still comes through
  prompt: string; // store words the model would otherwise mishear
  timeoutMs?: number;
};

// M21: one turn of a conversation in which the model may call the app's tools.
export type ToolCall = { id: string; name: string; arguments: string };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type ChatRequest = {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  signal: AbortSignal; // the caller's deadline for the whole answer
  onText?: (delta: string) => void; // the answer as it is written
};

export type ChatTurn = { text: string; toolCalls: ToolCall[] };

export type AiProvider = {
  // Resolves with the tool call's arguments, still unchecked JSON.
  fill(request: FillRequest): Promise<unknown>;
  transcribe(request: TranscribeRequest): Promise<{ text: string }>;
  // The model's next turn: text for the person, or tool calls for the app to run.
  chat(request: ChatRequest): Promise<ChatTurn>;
};

export class AiProviderError extends Error {
  readonly kind: "timeout" | "http" | "shape";
  constructor(kind: AiProviderError["kind"], message: string) {
    super(message);
    this.name = "AiProviderError";
    this.kind = kind;
  }
}

function apiKey(): string | null {
  return process.env["OPENAI_API_KEY"]?.trim() || null;
}

// True when the server has a key. The admin's switch has no effect without one, and the
// settings screen says so.
export function aiConfigured(): boolean {
  return apiKey() !== null;
}

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new AiProviderError("http", "OPENAI_API_KEY is not set");
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AiProviderError(timedOut ? "timeout" : "http", String(error));
  }
  if (!response.ok) {
    // The body names the problem (bad key, quota, model); the note itself is never in it.
    const detail = (await response.text()).slice(0, 300);
    logger.warn("ai.provider_error", { status: response.status, detail });
    throw new AiProviderError("http", `OpenAI ${response.status}`);
  }
  return response.json();
}

function toOpenAi(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    default:
      return message;
  }
}

type StreamChunk = {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
};

// Reads a streamed chat completion (server-sent events): text pieces go straight to
// onText, tool calls arrive in pieces and are put back together by their index.
async function readStream(
  body: ReadableStream<Uint8Array>,
  onText: ((delta: string) => void) | undefined,
): Promise<ChatTurn> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const calls: { id: string; name: string; arguments: string }[] = [];
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      throw new AiProviderError("shape", "a stream chunk is not JSON");
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      text += delta.content;
      onText?.(delta.content);
    }
    for (const part of delta.tool_calls ?? []) {
      const call = (calls[part.index] ??= { id: "", name: "", arguments: "" });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name += part.function.name;
      if (part.function?.arguments) call.arguments += part.function.arguments;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer);
  return { text, toolCalls: calls.filter((call) => call.name) };
}

const openAi: AiProvider = {
  async fill({ system, user, tool, timeoutMs = AI_FILL_TIMEOUT_MS }) {
    const body = {
      model: process.env["OPENAI_MODEL"]?.trim() || DEFAULT_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            strict: true,
            parameters: tool.parameters,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: tool.name } },
    };
    const json = (await call(
      "/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs,
    )) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (typeof args !== "string") throw new AiProviderError("shape", "no tool call in the answer");
    try {
      return JSON.parse(args) as unknown;
    } catch {
      throw new AiProviderError("shape", "tool arguments are not JSON");
    }
  },

  async transcribe({ audio, fileName, language, prompt, timeoutMs = AI_TRANSCRIBE_TIMEOUT_MS }) {
    const form = new FormData();
    form.append("file", audio, fileName);
    form.append(
      "model",
      process.env["OPENAI_TRANSCRIBE_MODEL"]?.trim() || DEFAULT_TRANSCRIBE_MODEL,
    );
    form.append("language", language);
    form.append("prompt", prompt);
    form.append("response_format", "json");
    const json = (await call(
      "/audio/transcriptions",
      { method: "POST", body: form },
      timeoutMs,
    )) as {
      text?: string;
    };
    if (typeof json.text !== "string") throw new AiProviderError("shape", "no text in the answer");
    return { text: json.text.trim() };
  },

  async chat({ messages, tools, signal, onText }) {
    const key = apiKey();
    if (!key) throw new AiProviderError("http", "OPENAI_API_KEY is not set");
    const body = {
      model: process.env["OPENAI_MODEL"]?.trim() || DEFAULT_MODEL,
      temperature: 0,
      stream: true,
      messages: messages.map(toOpenAi),
      // An empty list is refused by the API: no tools means "answer now".
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                strict: true,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
    };
    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok || !response.body) {
        const detail = (await response.text()).slice(0, 300);
        logger.warn("ai.provider_error", { status: response.status, detail });
        throw new AiProviderError("http", `OpenAI ${response.status}`);
      }
      return await readStream(response.body, onText);
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      const name = error instanceof Error ? error.name : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      throw new AiProviderError(timedOut ? "timeout" : "http", String(error));
    }
  },
};

export function aiProvider(): AiProvider {
  return openAi;
}
