// The one-time PIN an admin hands a new staff member (M03). Shown once on screen, never
// logged, never audited, and useless after the first login because `mustChangePin` sends
// them straight to /set-pin.
import { randomInt } from "node:crypto";
import { isBlockedPin } from "@/lib/validation/auth";

// randomInt, not Math.random: this is a credential, however short-lived.
export function generateTempPin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10_000)).padStart(4, "0");
    // The same rules a person's own PIN must pass, so an admin can never hand out 1234.
    if (!isBlockedPin(pin)) return pin;
  }
}
