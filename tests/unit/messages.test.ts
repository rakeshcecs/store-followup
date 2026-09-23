import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import gu from "../../messages/gu.json";
import hi from "../../messages/hi.json";
import { diffMessages, flatten, icuArgs } from "../../scripts/lib/message-diff";

describe("message files", () => {
  it.each([
    ["hi", hi],
    ["gu", gu],
  ])("%s is fully translated, with the same keys and placeholders as en", (locale, messages) => {
    expect(diffMessages(en, locale, messages)).toEqual([]);
  });

  it("has a message for every error code", async () => {
    const { defaultMessageKey } = await import("@/lib/errors");
    const english = new Set(flatten(en).keys());
    for (const key of Object.values(defaultMessageKey)) expect(english).toContain(key);
  });
});

describe("the check itself", () => {
  const english = { a: { b: "Hello {name}" }, c: "Only here" };

  it("reports a key the translator has not reached yet", () => {
    expect(diffMessages(english, "hi", { a: { b: "नमस्ते {name}" } })).toEqual([
      { locale: "hi", key: "c", kind: "missing" },
    ]);
  });

  it("reports a key that no longer exists in English", () => {
    const problems = diffMessages(english, "hi", {
      a: { b: "नमस्ते {name}" },
      c: "यहाँ",
      old: "पुराना",
    });
    expect(problems).toEqual([{ locale: "hi", key: "old", kind: "extra" }]);
  });

  it("reports a value still left in English", () => {
    const problems = diffMessages(english, "hi", { a: { b: "Hello {name}" }, c: "यहाँ" });
    expect(problems).toMatchObject([{ key: "a.b", kind: "untranslated" }]);
  });

  it("reports a dropped placeholder, which would break at run time", () => {
    const problems = diffMessages(english, "hi", { a: { b: "नमस्ते" }, c: "यहाँ" });
    expect(problems).toMatchObject([{ key: "a.b", kind: "placeholders" }]);
  });

  it("leaves values that are the same in every language alone", () => {
    expect(
      diffMessages({ app: { storeName: "[STORE NAME]" } }, "hi", {
        app: { storeName: "[STORE NAME]" },
      }),
    ).toEqual([]);
  });
});

describe("icuArgs", () => {
  it("finds a plain placeholder", () => {
    expect(icuArgs("Now showing {name}")).toEqual(["name"]);
  });

  it("finds the argument of a plural and ignores its branches", () => {
    expect(icuArgs("{count, plural, =0 {No staff} one {# person} other {# people}}")).toEqual([
      "count",
    ]);
  });

  it("finds nothing in a plain sentence", () => {
    expect(icuArgs("Enter the branch name.")).toEqual([]);
  });
});
