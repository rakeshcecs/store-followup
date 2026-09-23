import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import { LOCK_MINUTES, loginInput, MAX_FAILED_ATTEMPTS, setPinInput } from "@/lib/validation/auth";

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe("loginInput", () => {
  it("stores the normalised 10-digit mobile, whatever shape it was typed in", () => {
    const parsed = loginInput.parse({ mobile: "+91 98765 43210", pin: "4839" });
    expect(parsed.mobile).toBe("9876543210");
  });

  it("refuses a number that is not an Indian mobile", () => {
    const result = loginInput.safeParse({ mobile: "022 2345 6789", pin: "4839" });
    expect(firstMessage(result)).toBe("auth.errors.mobileInvalid");
  });

  it("accepts an obvious PIN when logging in", () => {
    // Deliberate: the PIN is only compared with a hash here. Refusing "1234" on the
    // login screen would tell an attacker which PINs are worth trying.
    expect(loginInput.safeParse({ mobile: "9876543210", pin: "1234" }).success).toBe(true);
  });

  it("carries the language chosen on the login screen, and works without one", () => {
    expect(loginInput.parse({ mobile: "9876543210", pin: "4839", language: "gu" }).language).toBe(
      "gu",
    );
    expect(loginInput.parse({ mobile: "9876543210", pin: "4839" }).language).toBeUndefined();
  });
});

describe("setPinInput", () => {
  const valid = { pin: "4839", confirmPin: "4839" };

  it("accepts a four-digit PIN with no pattern", () => {
    expect(setPinInput.safeParse(valid).success).toBe(true);
  });

  it.each(["0000", "1111", "7777", "9999", "1234", "4321"])("refuses %s", (pin) => {
    const result = setPinInput.safeParse({ pin, confirmPin: pin });
    expect(firstMessage(result)).toBe("auth.errors.pinTooSimple");
  });

  it.each(["123", "12345", "12a4", ""])("refuses %s as not four digits", (pin) => {
    const result = setPinInput.safeParse({ pin, confirmPin: pin });
    expect(firstMessage(result)).toBe("auth.errors.pinDigits");
  });

  it("refuses two PINs that do not match, and blames the second field", () => {
    const result = setPinInput.safeParse({ pin: "4839", confirmPin: "4830" });
    expect(result.error?.issues[0]?.message).toBe("auth.errors.pinMismatch");
    expect(result.error?.issues[0]?.path).toEqual(["confirmPin"]);
  });
});

describe("the policy and the message files agree", () => {
  // An ActionResult carries a message key and no values, so the locked message spells
  // the number out. These two must not drift apart.
  it("says the same number of minutes as LOCK_MINUTES", () => {
    expect(en.auth.errors.locked).toContain(String(LOCK_MINUTES));
  });

  it("locks on the fifth attempt", () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
  });
});
