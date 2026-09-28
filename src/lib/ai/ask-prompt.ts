// M21: what the model is told before a question. Pure text, no database, so the dates and
// the rules can be unit-tested (tests/unit/ask.test.ts).
import type { Role } from "@/generated/prisma/client";
import { addDays } from "@/lib/follow-up-dates";

export type AskPromptContext = {
  today: string; // IST day, "2026-09-25"
  storeName: string;
  role: Role;
  branchLabel: string; // "Branch A", "Branch A, Branch B" or "all branches"
  language: "en" | "hi" | "gu"; // the asker's app language, for an unclear question
  staffNames: string[]; // who a manager may ask about; empty for a salesperson
  categories: { nameEn: string; nameHi: string; nameGu: string }[];
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LANGUAGES = { en: "English", hi: "Hindi", gu: "Gujarati" } as const;

const weekday = (day: string) => WEEKDAYS[new Date(`${day}T00:00:00.000Z`).getUTCDay()]!;

function lastDayOfMonth(day: string): string {
  const [year, month] = day.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

// The calendar the model needs to turn "this week", "last month", "kal" into days.
export function askCalendar(today: string): string[] {
  const monday = addDays(today, -((new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
  const nextDays = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)).map(
    (day) => `${weekday(day)} ${day}`,
  );
  return [
    `Today: ${weekday(today)} ${today} (India time). Yesterday: ${addDays(today, -1)}.`,
    `This week: Monday ${monday} to Sunday ${addDays(monday, 6)}. Last week: ${addDays(monday, -7)} to ${addDays(monday, -1)}.`,
    `This month: ${monthStart} to ${lastDayOfMonth(today)}. Last month: ${lastMonthStart} to ${lastMonthEnd}.`,
    `Next 7 days: ${nextDays.join(", ")}.`,
  ];
}

function asker(ctx: AskPromptContext): string {
  switch (ctx.role) {
    case "SALESPERSON":
      return "The person asking is a salesperson. Every search returns ONLY their own customers, follow-ups and sales, in every branch they work in; they cannot see colleagues' data. 'I', 'my', 'mine', 'mere' mean them. If they ask about a colleague or another person's customers, tell them (in their language) that YOU, the asker, can only see your own customers, follow-ups and sales — never present their own records as someone else's.";
    case "MANAGER":
      return `The person asking is a store manager. Searches cover ${ctx.branchLabel}.`;
    default:
      return `The person asking is the admin (owner). Searches cover ${ctx.branchLabel}.`;
  }
}

export function buildAskPrompt(ctx: AskPromptContext): string {
  const lines = [
    `You answer questions from the staff of ${ctx.storeName}, a clothing store, about the store app's data: customers, follow-ups, sales and staff figures. You get the data only through the searches (tools) you are given.`,
    "",
    ...askCalendar(ctx.today),
    "",
    asker(ctx),
  ];
  if (ctx.staffNames.length > 0) lines.push(`Staff: ${ctx.staffNames.join(", ")}.`);
  if (ctx.categories.length > 0) {
    lines.push(
      `Requirement categories (English / Hindi / Gujarati): ${ctx.categories
        .map((c) => `${c.nameEn} / ${c.nameHi} / ${c.nameGu}`)
        .join("; ")}. Pass the English names to searches.`,
    );
  }
  lines.push(
    "",
    "Rules:",
    "1. Use ONLY what the searches return. Never guess or invent a number, a name or a date. If a search returns an error, explain it simply or ask the person to be more specific.",
    `2. Answer in the language and script of the question: English, Hindi, Gujarati, or mixed (Hinglish in Latin letters gets a Hinglish answer). If unsure, use ${LANGUAGES[ctx.language]}.`,
    "3. Keep it short: one or two sentences with the key number or finding. The app shows the rows of your last searches as a table under your answer, with links to each customer, so do NOT list the rows again (name at most three).",
    "4. If a search's total is more than the rows shown, say so (for example 'showing 50 of 132').",
    "5. If nothing is found, say that clearly.",
    "6. You can only read. If asked to add, change, delete, assign or send anything, say you can only answer questions and it has to be done in the app.",
    "7. Periods: for things that already happened (sales, visits, performance) 'this week' / 'this month' mean from the start of the week / month to today. For things planned (follow-ups due, customers who will visit) 'this week' means today to Sunday.",
    "8. 'Followed up today' / 'call today' = pending follow-ups due today; add overdue ones only if asked. 'Said they would visit' = follow-ups with method VISIT.",
    "9. Never mention searches, tools, JSON or ids. For questions that are not about the store's data, say what you can help with.",
    "10. If the question names a branch, pass it as branchName to every search. If a search says the asker cannot see that branch, tell them so and give no figures for it; never give the figures of another branch under that branch's name.",
  );
  return lines.join("\n");
}
