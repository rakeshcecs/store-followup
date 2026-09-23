// The server's own time zone must never leak into what a user sees.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import {
  collator,
  formatDate,
  formatDateTime,
  formatDayDate,
  formatMobile,
  formatMoney,
  formatMonthYear,
  formatNumber,
  formatTime,
  isoDate,
} from "@/lib/format";

const morning = new Date("2026-09-21T04:00:00Z"); // 09:30 IST, Monday

describe("dates", () => {
  it("writes the date the way the screens do", () => {
    expect(formatDate(morning, "en")).toBe("21 Sep 2026");
    expect(formatDate(morning, "hi")).toBe("21 सित॰ 2026");
    expect(formatDate(morning, "gu")).toBe("21 સપ્ટે, 2026");
  });

  it("shortens September to Sep in English, as the spec asks", () => {
    // CLDR writes "Sept" for en-IN; the spec says "21 Sep 2026".
    expect(formatDate(morning, "en")).not.toContain("Sept");
  });

  it("writes the day and date for the Today screen", () => {
    expect(formatDayDate(morning, "en")).toBe("Mon, 21 Sep");
    expect(formatDayDate(morning, "hi")).toBe("सोम, 21 सित॰");
  });

  it("writes the time", () => {
    expect(formatTime(morning, "en")).toBe("9:30 am");
  });

  it("joins the date and time", () => {
    expect(formatDateTime(morning, "en")).toBe("21 Sep 2026, 9:30 am");
  });

  it("writes month and year for report headings", () => {
    expect(formatMonthYear(morning, "en")).toBe("Sep 2026");
  });

  it("uses the Indian day, not the server's", () => {
    // 20:30 UTC is already the next morning in India.
    const lateEvening = new Date("2026-09-21T20:30:00Z");
    expect(isoDate(lateEvening)).toBe("2026-09-22");
    expect(formatDate(lateEvening, "en")).toBe("22 Sep 2026");
  });

  it("accepts a date that arrived as a string", () => {
    expect(formatDate("2026-09-21T04:00:00Z", "en")).toBe("21 Sep 2026");
  });

  it("really is translating, not falling back to English", () => {
    // A Node build without full ICU would quietly give English for every language.
    expect(formatDate(morning, "gu")).not.toBe(formatDate(morning, "en"));
    expect(formatDate(morning, "hi")).not.toBe(formatDate(morning, "en"));
  });
});

describe("numbers and money", () => {
  it("groups the Indian way in every language", () => {
    for (const locale of ["en", "hi", "gu"] as const) {
      expect(formatNumber(100000, locale), locale).toBe("1,00,000");
      expect(formatMoney(125000, locale), locale).toBe("₹1,25,000");
    }
  });

  it("shows paise only when asked", () => {
    expect(formatMoney(1250.5, "en")).toBe("₹1,251");
    expect(formatMoney(1250.5, "en", { decimals: 2 })).toBe("₹1,250.50");
  });

  it("accepts a bill amount that arrived as a Prisma decimal", () => {
    const billAmount = { toString: () => "125000" };
    expect(formatMoney(billAmount, "en")).toBe("₹1,25,000");
  });
});

describe("formatMobile", () => {
  it("splits a ten-digit number the way people read it", () => {
    expect(formatMobile("9876543210")).toBe("98765 43210");
  });

  it("leaves anything else alone", () => {
    expect(formatMobile("079 1234 5678")).toBe("079 1234 5678");
  });
});

describe("collator", () => {
  it("sorts in the reading language", () => {
    const names = ["ગોપાલ", "અમિત", "ભરત"];
    expect([...names].sort(collator("gu").compare)).toEqual(["અમિત", "ગોપાલ", "ભરત"]);
  });
});
