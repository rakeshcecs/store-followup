// The server's own time zone must never decide when a reminder goes out.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { formatList, istMinute } from "@/lib/format";
import { renderNotifications } from "@/lib/notification-text";
import { keyBytes, PROMPT_MAX_ASKS, PROMPT_SNOOZE_MS, shouldAsk, snooze } from "@/lib/push-prompt";
import { dueReminders } from "@/lib/reminders";
import { DEFAULT_REMINDER_TIMES, reminderTimesInput } from "@/lib/validation/reminders";

// M14: the pure parts — when each reminder starts, the settings rules, the permission
// card's rule, and the texts that need no names looked up.

// An IST wall-clock time on 24 Sep 2026, as the instant the worker sees.
const ist = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00.000+05:30`);

describe("istMinute", () => {
  it("reads the shop's clock, not the server's", () => {
    expect(istMinute(ist("09:30"))).toBe("09:30");
    expect(istMinute(new Date("2026-09-24T04:00:00Z"))).toBe("09:30");
    expect(istMinute(ist("00:05"))).toBe("00:05");
    expect(istMinute(ist("23:59"))).toBe("23:59");
  });
});

describe("dueReminders", () => {
  const types = (hhmm: string, times = DEFAULT_REMINDER_TIMES) =>
    dueReminders(times, ist(hhmm)).map((job) => job.singletonKey);

  it("starts each reminder at its default time (SOW: 9:30; 10:30, 2 PM, 5:30 PM; 8 PM)", () => {
    expect(types("09:30")).toEqual(["reminders-morning:2026-09-24"]);
    expect(types("10:30")).toEqual(["reminders-slot:2026-09-24:MORNING"]);
    expect(types("14:00")).toEqual(["reminders-slot:2026-09-24:AFTERNOON"]);
    expect(types("17:30")).toEqual(["reminders-slot:2026-09-24:EVENING"]);
    expect(types("20:00")).toEqual(["summary-manager:2026-09-24"]);
  });

  it("starts nothing in any other minute", () => {
    for (const hhmm of ["09:29", "09:31", "10:00", "13:59", "20:01", "00:00"]) {
      expect(types(hhmm)).toEqual([]);
    }
  });

  it("follows changed times: the old minute goes quiet, the new one starts", () => {
    const changed = { ...DEFAULT_REMINDER_TIMES, morningSummary: "08:45" };
    expect(types("09:30", changed)).toEqual([]);
    expect(types("08:45", changed)).toEqual(["reminders-morning:2026-09-24"]);
  });

  it("carries the IST date, so a reminder is one per day", () => {
    const [job] = dueReminders(DEFAULT_REMINDER_TIMES, ist("09:30"));
    expect(job?.payload).toEqual({ date: "2026-09-24" });
  });
});

describe("reminder settings validation", () => {
  it("accepts the defaults", () => {
    expect(reminderTimesInput.safeParse(DEFAULT_REMINDER_TIMES).success).toBe(true);
  });

  it("refuses anything that is not HH:MM", () => {
    for (const bad of ["9:30", "24:00", "09:60", "morning", ""]) {
      const result = reminderTimesInput.safeParse({
        ...DEFAULT_REMINDER_TIMES,
        morningSummary: bad,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("reminderSettings.errors.time");
    }
  });

  it("keeps the slots in day order", () => {
    const result = reminderTimesInput.safeParse({
      ...DEFAULT_REMINDER_TIMES,
      slotAfternoon: "10:00", // before the morning slot
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("reminderSettings.errors.slotOrder");
  });
});

describe("permission card rule (M14: again after 3 days, at most 3 times)", () => {
  const now = Date.UTC(2026, 8, 24);

  it("asks the first time", () => {
    expect(shouldAsk(null, now)).toBe(true);
  });

  it("waits 3 days after Not now", () => {
    const state = snooze(null, now);
    expect(shouldAsk(state, now + PROMPT_SNOOZE_MS - 1)).toBe(false);
    expect(shouldAsk(state, now + PROMPT_SNOOZE_MS)).toBe(true);
  });

  it("stops after the third Not now", () => {
    let state = null;
    for (let i = 0; i < PROMPT_MAX_ASKS; i += 1) state = snooze(state, now);
    expect(shouldAsk(state, now + 365 * PROMPT_SNOOZE_MS)).toBe(false);
  });

  it("turns the VAPID key into bytes", () => {
    expect([...keyBytes("AQID")]).toEqual([1, 2, 3]);
    expect([...keyBytes("-_8")]).toEqual([251, 255]);
  });
});

describe("notification texts", () => {
  const row = (type: string, message: string, link = "/today") => ({
    id: type,
    type,
    message,
    link,
  });

  it("writes the morning summary in each language", async () => {
    const rows = [row("summary-morning", "summary-morning:2026-09-24:5:2")];
    expect((await renderNotifications(rows, "en")).get("summary-morning")).toEqual({
      title: "Today's follow-ups",
      body: "Good morning! You have 5 follow-ups today and 2 overdue.",
      link: "/today",
    });
    const hi = (await renderNotifications(rows, "hi")).get("summary-morning");
    expect(hi?.body).toContain("5");
    expect(hi?.body).not.toContain("Good morning");
    const gu = (await renderNotifications(rows, "gu")).get("summary-morning");
    expect(gu?.body).toContain("સુપ્રભાત");
  });

  it("says one follow-up, not one follow-ups", async () => {
    const rows = [row("summary-morning", "summary-morning:2026-09-24:1:0")];
    expect((await renderNotifications(rows, "en")).get("summary-morning")?.body).toBe(
      "Good morning! You have 1 follow-up today and 0 overdue.",
    );
  });

  it("writes the all-branches summary for an admin", async () => {
    const rows = [
      row("summary-manager", "summary-manager:2026-09-24:all:42:12:8:15:7", "/overview"),
    ];
    expect((await renderNotifications(rows, "en")).get("summary-manager")).toEqual({
      title: "Today at all branches",
      body: "42 visits, 12 sales, 8 of 15 follow-ups done, 7 overdue.",
      link: "/overview",
    });
  });

  it("joins names the way the language does", () => {
    expect(formatList(["Rajesh Patel", "Neha Shah"], "en")).toBe("Rajesh Patel and Neha Shah");
    expect(formatList(["Rajesh Patel"], "en")).toBe("Rajesh Patel");
  });
});
