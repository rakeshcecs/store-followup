// When to ask for notification permission (M14): after "Not now", ask again 3 days
// later, and stop after the third "Not now". Pure, so it is tested without a browser;
// the card keeps this state in localStorage (a per-device convenience only).

export const PROMPT_MAX_ASKS = 3;
export const PROMPT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export type PromptState = { asks: number; nextAt: number };

export function shouldAsk(state: PromptState | null, now: number): boolean {
  if (!state) return true;
  return state.asks < PROMPT_MAX_ASKS && now >= state.nextAt;
}

export function snooze(state: PromptState | null, now: number): PromptState {
  return { asks: (state?.asks ?? 0) + 1, nextAt: now + PROMPT_SNOOZE_MS };
}

// The VAPID public key as the bytes pushManager.subscribe() wants.
export function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
