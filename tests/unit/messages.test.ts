import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import gu from "../../messages/gu.json";
import hi from "../../messages/hi.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? keys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("message files", () => {
  const english = keys(en).sort();

  it.each([
    ["hi", hi],
    ["gu", gu],
  ])("%s has exactly the same keys as en", (_, messages) => {
    expect(keys(messages).sort()).toEqual(english);
  });

  it("has a message for every error code", async () => {
    const { defaultMessageKey } = await import("@/lib/errors");
    for (const key of Object.values(defaultMessageKey)) expect(english).toContain(key);
  });
});
