import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptionConfigured, seal, unseal } from "@/lib/secret-box";
import { appNumber, isRetryable, metaNumber } from "@/lib/whatsapp/meta";
import { windowOpen } from "@/lib/whatsapp/send";
import {
  appLanguage,
  appStatus,
  fillTemplate,
  firstName,
  placeholders,
  renderBody,
} from "@/lib/whatsapp/templates";
import { isStop, validSignature } from "@/lib/whatsapp/webhook";

// M22's pure rules: the secret box, templates, numbers, STOP words, the signature, the
// 24-hour window.

describe("secret box", () => {
  const saved = process.env.APP_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  afterEach(() => {
    process.env.APP_ENCRYPTION_KEY = saved;
  });

  it("seals and opens, never storing the plain text", () => {
    const sealed = seal("EAAG-secret-token");
    expect(sealed).not.toContain("EAAG");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(unseal(sealed)).toBe("EAAG-secret-token");
    expect(seal("same")).not.toBe(seal("same")); // a new IV every time
  });

  it("gives null for another key, a damaged value or nothing", () => {
    const sealed = seal("token");
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(unseal(sealed)).toBeNull();
    expect(unseal("v1:abc")).toBeNull();
    expect(unseal(null)).toBeNull();
  });

  it("refuses to seal without a 32-byte key", () => {
    process.env.APP_ENCRYPTION_KEY = "short";
    expect(encryptionConfigured()).toBe(false);
    expect(() => seal("x")).toThrow("whatsapp.errors.noEncryptionKey");
  });
});

describe("templates", () => {
  const template = {
    variables: ["1", "2"],
    mapping: { "1": "customerFirstName", "2": "billNumber" },
  };

  it("finds the placeholders in Meta's order, once each", () => {
    expect(placeholders("Hi {{1}}, bill {{2}}. Thanks {{1}}! {{ 10 }}")).toEqual(["1", "2", "10"]);
    expect(placeholders("No placeholders")).toEqual([]);
  });

  it("fills each placeholder from its field, or names the missing one", () => {
    expect(fillTemplate(template, { customerFirstName: "Asha", billNumber: "B-12" })).toEqual({
      ok: true,
      parameters: ["Asha", "B-12"],
    });
    expect(fillTemplate(template, { customerFirstName: "Asha", billNumber: "  " })).toEqual({
      ok: false,
      missing: "billNumber",
    });
    expect(fillTemplate({ variables: ["1"], mapping: {} }, {})).toEqual({
      ok: false,
      missing: "unmapped",
    });
    expect(fillTemplate({ variables: [], mapping: null }, {})).toEqual({
      ok: true,
      parameters: [],
    });
  });

  it("renders the message the customer will read", () => {
    expect(renderBody("Hi {{1}}, bill {{2}}.", ["1", "2"], ["Asha", "B-12"])).toBe(
      "Hi Asha, bill B-12.",
    );
    expect(firstName("  Asha  Patel ")).toBe("Asha");
  });

  it("speaks Meta's language codes and statuses", () => {
    expect(appLanguage("en_US")).toBe("en");
    expect(appLanguage("hi")).toBe("hi");
    expect(appLanguage("gu")).toBe("gu");
    expect(appLanguage("mr")).toBeNull();
    expect(appStatus("APPROVED")).toBe("APPROVED");
    expect(appStatus("IN_APPEAL")).toBe("PENDING");
    expect(appStatus("PAUSED")).toBe("REJECTED");
    expect(appStatus("DISABLED")).toBe("REJECTED");
  });
});

describe("numbers and errors", () => {
  it("adds and removes the country code", () => {
    expect(metaNumber("9825012345")).toBe("919825012345");
    expect(appNumber("919825012345")).toBe("9825012345");
    expect(appNumber("+91 98250 12345")).toBe("9825012345");
    expect(appNumber("14155550100")).toBeNull();
  });

  it("retries rate limits and Meta hiccups, not a bad number or a template problem", () => {
    expect(isRetryable("130429", 400)).toBe(true);
    expect(isRetryable("131000", 500)).toBe(true);
    expect(isRetryable("x", 503)).toBe(true);
    expect(isRetryable("131026", 400)).toBe(false);
    expect(isRetryable("132001", 400)).toBe(false);
    expect(isRetryable("190", 401)).toBe(false);
  });
});

describe("webhook rules", () => {
  it("knows STOP in English, Hindi and Gujarati, and Meta's opt-out button", () => {
    for (const word of ["STOP", "Stop", " stop. ", "बंद", "બંધ", "Stop promotions", "बंद।"]) {
      expect(isStop(word), word).toBe(true);
    }
    for (const word of ["Stop sending me the bill", "please stop by", "ok", "बंद करो"]) {
      expect(isStop(word), word).toBe(false);
    }
  });

  it("accepts only Meta's signature over the exact body", () => {
    const body = '{"entry":[]}';
    const sign = (text: string, secret: string) =>
      `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`;
    expect(validSignature(body, sign(body, "app-secret"), "app-secret")).toBe(true);
    expect(validSignature(body, sign(body, "other"), "app-secret")).toBe(false);
    expect(validSignature(`${body} `, sign(body, "app-secret"), "app-secret")).toBe(false);
    expect(validSignature(body, null, "app-secret")).toBe(false);
    expect(validSignature(body, "sha256=zz", "app-secret")).toBe(false);
  });

  it("the reply window is 24 hours from the customer's last message (BR-20)", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    expect(windowOpen(new Date("2026-09-24T12:30:00Z"), now)).toBe(true);
    expect(windowOpen(new Date("2026-09-24T11:59:00Z"), now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });
});
