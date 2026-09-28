// M21: the only way the AI reaches the data. Six fixed searches, each a plain TypeScript
// function over Prisma with the asker's permissions applied — the model picks a search and
// fills in its filters, it never writes a query (BR-18). Nothing in this file writes:
// tests/unit/ask-tools.test.ts fails the build if a create/update/delete appears here, and
// tests/db/ask.test.ts counts every table before and after running each search.
//
// Who sees what (M21.05, the SOW permission table "Ask AI questions: about own customers /
// own branch / all branches"):
// - a salesperson: their own follow-ups, customers and sales, in every branch they work in;
// - a manager or an admin: the branches in the switcher, like the Store overview.
//
// What goes back to the model: names, dates, counts and amounts — never a customer's
// mobile or address. The same rows, formatted for the reader, become the table under the
// answer, so every name in it links to the real profile and every number is the database's.
import { createTranslator } from "next-intl";
import { z } from "zod";
import type { Prisma, Role } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";
import type { SessionUser } from "@/lib/auth";
import type { ToolDefinition } from "@/lib/ai/provider";
import { loadOverview } from "@/lib/dashboard";
import { CUSTOM_MAX_DAYS, dateWhere, instantWhere, type DayRange } from "@/lib/dashboard-period";
import { db } from "@/lib/db";
import { DAY_ORDER } from "@/lib/follow-up-list";
import { addDays, daysBetween } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";
import { localizedName } from "@/lib/localized-name";
import { loadMessages } from "@/lib/messages";
import { accessScope, branchWhere, branchWhereShared, type BranchScope } from "@/lib/permissions";
import { parseFilters, type Cell, type ColumnKind } from "@/lib/reports/core";
import { REPORTS } from "@/lib/reports/definitions";
import { formatCell, isNumeric } from "@/lib/reports/format-cell";
import { staffBranchWhere } from "@/lib/staff-scope";
import { isRealDay } from "@/lib/validation/common";
import type { AskTable } from "@/lib/validation/ai";

// "Each tool returns at most 50 rows; the answer says 'showing 50 of 132' when cut."
export const ASK_MAX_ROWS = 50;

export const SALESPERSON_OWN_ONLY =
  "A salesperson can only see their own customers, follow-ups and sales, not a colleague's.";

export type AskActor = {
  user: SessionUser;
  self: string | null; // a salesperson: their own records only
  scope: BranchScope;
  today: string; // IST day
  locale: Locale;
};

// Every message the tables need, in the reader's language.
export type AskText = (key: string, values?: Record<string, string | number>) => string;

export async function askText(locale: Locale): Promise<AskText> {
  const t = createTranslator({ locale, messages: await loadMessages(locale) });
  return (key, values) => t(key as Parameters<typeof t>[0], values);
}

export type ToolOutcome = {
  forModel: unknown; // compact JSON for the model
  table: AskTable | null; // what the reader sees
  total: number;
  error?: string;
};

type AskToolDef = ToolDefinition & {
  roles: Role[];
  run: (args: unknown, actor: AskActor, t: AskText) => Promise<ToolOutcome>;
};

// ---------- shared pieces ----------

const refuse = (error: string): ToolOutcome => ({
  forModel: { error },
  table: null,
  total: 0,
  error,
});

const day = z
  .string()
  .nullish()
  .transform((value) => (value && isRealDay(value) ? value : null));
const text = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || null);
const flag = z.boolean().nullish();

// The strict JSON Schema pieces: with strict tools every property is required, so an
// optional filter is "this type or null".
const nullable = (type: string, description: string) => ({ type: [type, "null"], description });
const nullableEnum = (values: readonly string[], description: string) => ({
  type: ["string", "null"],
  enum: [...values, null],
  description,
});
const schema = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// A period the model asked for, or this month so far. Backwards or over a year is refused
// (the reports' own rule, M13.04).
function periodOf(from: string | null, to: string | null, today: string): DayRange | string {
  const range = { from: from ?? `${today.slice(0, 8)}01`, to: to ?? today };
  if (range.from > range.to) return "The period ends before it starts.";
  if (daysBetween(range.from, range.to) >= CUSTOM_MAX_DAYS) return "The period is over a year.";
  return range;
}

// Whether a name asked for is this one, word by word: every word asked for starts a word
// of the name ("amit" finds "Amit Shah"), and a single letter must be a whole word — the
// "a" of "Salesman A" is not the one inside "Test Salesman", and "Branch B" is not
// "Branch A" because "b" starts "branch".
export function nameMatches(full: string, asked: string): boolean {
  const tokens = full
    .toLowerCase()
    .split(/[\s\-–—·,]+/)
    .filter(Boolean);
  const words = asked
    .toLowerCase()
    .split(/[\s\-–—·,]+/)
    .filter(Boolean);
  return (
    words.length > 0 &&
    words.every((word) =>
      tokens.some((token) => (word.length === 1 ? token === word : token.startsWith(word))),
    )
  );
}

// Staff the asker may see, found by (part of) their name. A salesperson is always
// themselves: asking about a colleague is refused in words the model passes on, rather
// than quietly answered with the salesperson's own rows under the colleague's name.
async function staffNamed(
  actor: AskActor,
  name: string | null,
): Promise<{ ids: string[] | null } | { error: string }> {
  if (actor.self) {
    if (!name) return { ids: [actor.self] };
    const own = await db.user.findUnique({ where: { id: actor.self }, select: { fullName: true } });
    return own && nameMatches(own.fullName, name)
      ? { ids: [actor.self] }
      : { error: SALESPERSON_OWN_ONLY };
  }
  if (!name) return { ids: null };
  const staff = await db.user.findMany({
    where: staffBranchWhere(actor.scope),
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const wanted = name.toLowerCase();
  const exact = staff.filter((person) => person.fullName.toLowerCase() === wanted);
  if (exact.length > 0) return { ids: exact.map((person) => person.id) };
  const matches = staff.filter((person) => nameMatches(person.fullName, name));
  const names = staff.map((person) => person.fullName).join(", ");
  if (matches.length === 0) return { error: `No staff member called "${name}". Staff: ${names}` };
  if (matches.length > 1) {
    return {
      error: `"${name}" matches ${matches.map((p) => p.fullName).join(", ")}. Ask which one.`,
    };
  }
  return { ids: [matches[0]!.id] };
}

// A branch the question names ("sales in Branch A"): any branch the asker may reach, not
// only the one on screen. One they cannot reach is refused in words the model passes on,
// so it never answers with the on-screen branch's figures under the other branch's name.
async function branchNamed(
  actor: AskActor,
  name: string | null,
): Promise<{ scope: BranchScope; branch: string | null } | { error: string }> {
  if (!name) return { scope: actor.scope, branch: null };
  const reach = accessScope(actor.user);
  const branches = await db.branch.findMany({
    where: { status: "ACTIVE", ...(reach.all ? {} : { id: { in: reach.branchIds } }) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const wanted = name.trim().toLowerCase();
  const exact = branches.filter((b) => b.name.toLowerCase() === wanted);
  const matches = exact.length > 0 ? exact : branches.filter((b) => nameMatches(b.name, name));
  if (matches.length === 1) {
    return { scope: { all: false, branchIds: [matches[0]!.id] }, branch: matches[0]!.name };
  }
  const names = branches.map((b) => b.name).join(", ");
  if (matches.length > 1) {
    return { error: `"${name}" matches ${matches.map((b) => b.name).join(", ")}. Ask which one.` };
  }
  return {
    error: `The asker cannot see a branch called "${name}". They can only see: ${names}. Tell them so, and do not give another branch's figures instead.`,
  };
}

const branchNameParam = nullable(
  "string",
  "Only this branch, by name, when the question names a branch. Default: the branches on screen.",
);

type Col = { key: string; kind: ColumnKind };

function table(
  t: AskText,
  locale: Locale,
  key: string,
  columns: Col[],
  rows: { cells: Record<string, Cell>; href?: string }[],
  total: number,
): AskTable {
  const shown = rows.length;
  return {
    key,
    title: t(`ask.tables.${key}`),
    ...(total > shown ? { note: t("ask.shown", { shown, total }) } : {}),
    columns: columns.map((column) => ({
      label: t(`ask.columns.${column.key}`),
      numeric: isNumeric({ ...column, label: "" }),
    })),
    rows: rows.map((row) => ({
      cells: columns.map((column) =>
        formatCell({ ...column, label: "" }, row.cells[column.key] ?? null, locale),
      ),
      ...(row.href ? { href: row.href } : {}),
    })),
  };
}

// A privacy-deleted customer (M16) has no profile to open.
const profileHref = (customer: { id: string; active: boolean }) =>
  customer.active ? `/customers/${customer.id}` : undefined;

// ---------- find_followups ----------

const FOLLOW_UP_STATUSES = ["pending", "done", "rescheduled", "cancelled"] as const;
const METHODS = ["CALL", "WHATSAPP", "VISIT"] as const;

const followUpArgs = z.object({
  status: z.enum(FOLLOW_UP_STATUSES).nullish(),
  overdueOnly: flag,
  dueFrom: day,
  dueTo: day,
  salespersonName: text,
  method: z.enum(METHODS).nullish(),
  branchName: text,
});

const findFollowUps: AskToolDef = {
  name: "find_followups",
  description:
    "Follow-ups (planned calls, WhatsApps and customer visits) with their customer, due day, time slot, method, reason and salesperson. Pending ones by default. Use for 'who should be followed up today', 'overdue calls', 'who said they would visit this week' (method VISIT, due this week).",
  parameters: schema({
    status: nullableEnum(FOLLOW_UP_STATUSES, "Default pending."),
    overdueOnly: nullable("boolean", "Only pending follow-ups due before today."),
    dueFrom: nullable("string", "First due day, YYYY-MM-DD."),
    dueTo: nullable("string", "Last due day, YYYY-MM-DD."),
    salespersonName: nullable("string", "Only this salesperson's follow-ups."),
    method: nullableEnum(METHODS, "CALL, WHATSAPP, or VISIT (the customer said they will come)."),
    branchName: branchNameParam,
  }),
  roles: ["SALESPERSON", "MANAGER", "ADMIN"],
  run: async (raw, actor, t) => {
    const args = followUpArgs.parse(raw);
    const staff = await staffNamed(actor, args.salespersonName);
    if ("error" in staff) return refuse(staff.error);
    const named = await branchNamed(actor, args.branchName);
    if ("error" in named) return refuse(named.error);
    const status = args.overdueOnly ? "pending" : (args.status ?? "pending");
    const where: Prisma.FollowUpWhereInput = {
      AND: [
        actor.self
          ? { assignedToId: actor.self, ...(named.branch ? branchWhere(named.scope) : {}) }
          : {
              ...branchWhere(named.scope),
              ...(staff.ids ? { assignedToId: { in: staff.ids } } : {}),
            },
        { status: status.toUpperCase() as "PENDING" },
        args.overdueOnly ? { dueDate: { lt: calendarDay(actor.today) } } : {},
        args.dueFrom ? { dueDate: { gte: calendarDay(args.dueFrom) } } : {},
        args.dueTo ? { dueDate: { lte: calendarDay(args.dueTo) } } : {},
        args.method ? { method: args.method } : {},
      ],
    };
    const [total, rows] = await Promise.all([
      db.followUp.count({ where }),
      db.followUp.findMany({
        where,
        orderBy: status === "pending" ? DAY_ORDER : [{ dueDate: "desc" }, { createdAt: "desc" }],
        take: ASK_MAX_ROWS,
        select: {
          dueDate: true,
          timeSlot: true,
          method: true,
          reason: true,
          status: true,
          result: true,
          customer: { select: { id: true, name: true, active: true } },
          enquiry: { select: { title: true } },
          assignedTo: { select: { fullName: true } },
        },
      }),
    ]);
    const columns: Col[] = [
      { key: "customer", kind: "text" },
      { key: "dueDate", kind: "day" },
      { key: "slot", kind: "text" },
      { key: "method", kind: "text" },
      { key: "reason", kind: "text" },
      ...(actor.self ? [] : [{ key: "salesperson", kind: "text" as const }]),
      ...(status === "pending" ? [] : [{ key: "result", kind: "text" as const }]),
    ];
    return {
      total,
      forModel: {
        total,
        shown: rows.length,
        status,
        followUps: rows.map((row) => ({
          customer: row.customer.name,
          lookingFor: row.enquiry.title,
          due: isoDate(row.dueDate),
          slot: row.timeSlot,
          method: row.method,
          reason: row.reason,
          result: row.result,
          salesperson: row.assignedTo.fullName,
        })),
      },
      table: table(
        t,
        actor.locale,
        "followUps",
        columns,
        rows.map((row) => ({
          href: profileHref(row.customer),
          cells: {
            customer: row.customer.name,
            dueDate: isoDate(row.dueDate),
            slot: t(`followUps.slot.${row.timeSlot}`),
            method: t(`followUps.method.${row.method}`),
            reason: row.reason ?? row.enquiry.title,
            salesperson: row.assignedTo.fullName,
            result: row.result ? t(`followUpResult.option.${row.result}.label`) : null,
          },
        })),
        total,
      ),
    };
  },
};

// ---------- find_customers ----------

const EXPECTED = ["THIS_WEEK", "THIS_MONTH", "NEXT_MONTH", "NOT_SURE"] as const;
const INTENTS = ["HOT", "WARM", "COLD"] as const;

const customerArgs = z.object({
  categoryNames: z.array(z.string()).nullish(),
  expectedPurchase: z.enum(EXPECTED).nullish(),
  lastVisitFrom: day,
  lastVisitTo: day,
  notContactedDays: z.number().int().min(1).max(366).nullish(),
  intent: z.enum(INTENTS).nullish(),
  hasOpenEnquiry: flag,
  salespersonName: text,
  branchName: text,
});

// Which customers "belong" to the asker: a salesperson's are the ones assigned to them; a
// manager's are the ones whose home branch is in the switcher or who visited one of those
// branches (customers are shared, BR-16, so a visit elsewhere does not hide them).
function customersOf(actor: AskActor, scope: BranchScope): Prisma.CustomerWhereInput {
  if (actor.self) return { assignedToId: actor.self };
  if (scope.all) return {};
  const branchIds = scope.branchIds;
  return {
    OR: [{ homeBranchId: { in: branchIds } }, { visits: { some: { ...branchWhere(scope) } } }],
  };
}

const findCustomers: AskToolDef = {
  name: "find_customers",
  description:
    "Customers with what they are looking for (open enquiry, requirement categories, expected purchase, intent), last visit, next follow-up and salesperson. Category, expected purchase and intent filters look at the customer's OPEN enquiry. 'Pending customers' = hasOpenEnquiry true. 'Not contacted in N days' = no visit and no completed follow-up in the last N days.",
  parameters: schema({
    categoryNames: {
      type: ["array", "null"],
      items: { type: "string" },
      description: "Requirement categories, as named in the list you were given.",
    },
    expectedPurchase: nullableEnum(EXPECTED, "When the customer expects to buy."),
    lastVisitFrom: nullable("string", "Last visit on or after this day, YYYY-MM-DD."),
    lastVisitTo: nullable("string", "Last visit on or before this day, YYYY-MM-DD."),
    notContactedDays: nullable("integer", "No visit and no completed follow-up in this many days."),
    intent: nullableEnum(INTENTS, "HOT, WARM or COLD."),
    hasOpenEnquiry: nullable("boolean", "true: still deciding (pending). false: no open enquiry."),
    salespersonName: nullable("string", "Only the customers assigned to this salesperson."),
    branchName: branchNameParam,
  }),
  roles: ["SALESPERSON", "MANAGER", "ADMIN"],
  run: async (raw, actor, t) => {
    const args = customerArgs.parse(raw);
    const staff = await staffNamed(actor, args.salespersonName);
    if ("error" in staff) return refuse(staff.error);
    const named = await branchNamed(actor, args.branchName);
    if ("error" in named) return refuse(named.error);

    let categoryIds: string[] | null = null;
    if (args.categoryNames?.length) {
      const categories = await db.requirementCategory.findMany({
        where: { active: true, ...branchWhereShared(actor.scope) },
        select: { id: true, nameEn: true, nameHi: true, nameGu: true },
      });
      const names = (c: (typeof categories)[number]) =>
        [c.nameEn, c.nameHi, c.nameGu].map((n) => n.toLowerCase());
      const wanted = args.categoryNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
      categoryIds = categories
        .filter((c) =>
          wanted.some((w) => names(c).some((n) => n === w || n.includes(w) || w.includes(n))),
        )
        .map((c) => c.id);
      if (categoryIds.length === 0) {
        return refuse(
          `No requirement category matches ${args.categoryNames.join(", ")}. Categories: ${categories.map((c) => c.nameEn).join(", ")}`,
        );
      }
    }

    const openEnquiry: Prisma.EnquiryWhereInput = {
      status: "OPEN",
      ...(categoryIds ? { categories: { some: { categoryId: { in: categoryIds } } } } : {}),
      ...(args.expectedPurchase ? { expectedPurchase: args.expectedPurchase } : {}),
      ...(args.intent ? { intent: args.intent } : {}),
    };
    const needsOpen =
      categoryIds !== null || !!args.expectedPurchase || !!args.intent || args.hasOpenEnquiry;

    const and: Prisma.CustomerWhereInput[] = [customersOf(actor, named.scope), { active: true }];
    // A salesperson's are theirs already; for a manager this is "Salesman B's customers".
    if (staff.ids && !actor.self) and.push({ assignedToId: { in: staff.ids } });
    // A salesperson naming a branch: their customers seen there.
    if (actor.self && named.branch) and.push({ visits: { some: branchWhere(named.scope) } });
    if (needsOpen) and.push({ enquiries: { some: openEnquiry } });
    else if (args.hasOpenEnquiry === false) and.push({ enquiries: { none: { status: "OPEN" } } });
    if (args.lastVisitFrom || args.lastVisitTo) {
      // The LAST visit falls in the range: one visit inside it, none after it.
      const from = args.lastVisitFrom ?? "2000-01-01";
      const to = args.lastVisitTo ?? actor.today;
      and.push({ visits: { some: { visitAt: instantWhere({ from, to }) } } });
      if (args.lastVisitTo) {
        and.push({ visits: { none: { visitAt: { gte: instantWhere({ from, to }).lt } } } });
      }
    }
    if (args.notContactedDays) {
      const since = instantWhere({
        from: addDays(actor.today, -args.notContactedDays),
        to: actor.today,
      }).gte;
      and.push(
        { createdAt: { lt: since } },
        { visits: { none: { visitAt: { gte: since } } } },
        { followUps: { none: { completedAt: { gte: since } } } },
      );
    }
    const where: Prisma.CustomerWhereInput = { AND: and };

    const [total, rows] = await Promise.all([
      db.customer.count({ where }),
      db.customer.findMany({
        where,
        orderBy: [{ name: "asc" }],
        take: ASK_MAX_ROWS,
        // No mobile, no address: not needed for the answer, and not for the model.
        select: {
          id: true,
          name: true,
          active: true,
          assignedTo: { select: { fullName: true } },
          enquiries: {
            where: { status: "OPEN" },
            take: 1,
            select: {
              title: true,
              expectedPurchase: true,
              intent: true,
              categories: {
                select: { category: { select: { nameEn: true, nameHi: true, nameGu: true } } },
              },
            },
          },
          visits: { orderBy: { visitAt: "desc" }, take: 1, select: { visitAt: true } },
          followUps: { where: { status: "PENDING" }, take: 1, select: { dueDate: true } },
        },
      }),
    ]);
    const shaped = rows.map((row) => {
      const enquiry = row.enquiries[0];
      return {
        row,
        enquiry,
        categories: (enquiry?.categories ?? []).map((c) => localizedName(c.category, actor.locale)),
        lastVisit: row.visits[0] ? isoDate(row.visits[0].visitAt) : null,
        nextFollowUp: row.followUps[0] ? isoDate(row.followUps[0].dueDate) : null,
      };
    });
    return {
      total,
      forModel: {
        total,
        shown: rows.length,
        customers: shaped.map((c) => ({
          name: c.row.name,
          lookingFor: c.enquiry?.title ?? null,
          categories: (c.enquiry?.categories ?? []).map((x) => x.category.nameEn),
          expectedPurchase: c.enquiry?.expectedPurchase ?? null,
          intent: c.enquiry?.intent ?? null,
          lastVisit: c.lastVisit,
          nextFollowUp: c.nextFollowUp,
          salesperson: c.row.assignedTo.fullName,
        })),
      },
      table: table(
        t,
        actor.locale,
        "customers",
        [
          { key: "customer", kind: "text" },
          { key: "lookingFor", kind: "text" },
          { key: "expected", kind: "text" },
          { key: "lastVisit", kind: "day" },
          { key: "nextFollowUp", kind: "day" },
          ...(actor.self ? [] : [{ key: "salesperson", kind: "text" as const }]),
        ],
        shaped.map((c) => ({
          href: profileHref(c.row),
          cells: {
            customer: c.row.name,
            lookingFor: c.categories.length ? c.categories.join(", ") : (c.enquiry?.title ?? null),
            expected: c.enquiry?.expectedPurchase
              ? t(`visits.expected.${c.enquiry.expectedPurchase}`)
              : null,
            lastVisit: c.lastVisit,
            nextFollowUp: c.nextFollowUp,
            salesperson: c.row.assignedTo.fullName,
          },
        })),
        total,
      ),
    };
  },
};

// ---------- get_sales ----------

const salesArgs = z.object({
  from: day,
  to: day,
  salespersonName: text,
  fromFollowUp: flag,
  branchName: text,
});

const getSales: AskToolDef = {
  name: "get_sales",
  description:
    "Sales (bills) in a period: count, how many came from follow-ups, total amount, and the bills. Cancelled bills are never counted. Period = bill date.",
  parameters: schema({
    from: nullable("string", "First bill day, YYYY-MM-DD. Default: 1st of this month."),
    to: nullable("string", "Last bill day, YYYY-MM-DD. Default: today."),
    salespersonName: nullable("string", "Only this salesperson's sales."),
    fromFollowUp: nullable("boolean", "true: only sales that came from follow-ups."),
    branchName: branchNameParam,
  }),
  roles: ["SALESPERSON", "MANAGER", "ADMIN"],
  run: async (raw, actor, t) => {
    const args = salesArgs.parse(raw);
    const range = periodOf(args.from, args.to, actor.today);
    if (typeof range === "string") return refuse(range);
    const staff = await staffNamed(actor, args.salespersonName);
    if ("error" in staff) return refuse(staff.error);
    const named = await branchNamed(actor, args.branchName);
    if ("error" in named) return refuse(named.error);
    const base: Prisma.SaleWhereInput = {
      ...branchWhere(named.scope),
      billDate: dateWhere(range),
      cancelled: false,
      ...(staff.ids ? { salespersonId: { in: staff.ids } } : {}),
    };
    const where: Prisma.SaleWhereInput = {
      ...base,
      ...(args.fromFollowUp != null ? { fromFollowUp: args.fromFollowUp } : {}),
    };
    const [total, fromFollowUps, amount, rows] = await Promise.all([
      db.sale.count({ where }),
      db.sale.count({ where: { ...where, fromFollowUp: true } }),
      db.sale.aggregate({ where, _sum: { billAmount: true } }),
      db.sale.findMany({
        where,
        orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
        take: ASK_MAX_ROWS,
        select: {
          billDate: true,
          billNumber: true,
          billAmount: true,
          fromFollowUp: true,
          customer: { select: { id: true, name: true, active: true } },
          salesperson: { select: { fullName: true } },
        },
      }),
    ]);
    const sum = Number(amount._sum.billAmount ?? 0);
    return {
      total,
      forModel: {
        from: range.from,
        to: range.to,
        onlyFromFollowUps: args.fromFollowUp === true,
        salesCount: total,
        salesFromFollowUps: fromFollowUps,
        totalAmount: sum,
        shown: rows.length,
        bills: rows.map((row) => ({
          billDate: isoDate(row.billDate),
          billNumber: row.billNumber,
          customer: row.customer.name,
          amount: row.billAmount === null ? null : Number(row.billAmount),
          salesperson: row.salesperson.fullName,
          fromFollowUp: row.fromFollowUp,
        })),
      },
      table: table(
        t,
        actor.locale,
        "sales",
        [
          { key: "billDate", kind: "day" },
          { key: "customer", kind: "text" },
          { key: "billNumber", kind: "text" },
          { key: "amount", kind: "money" },
          ...(actor.self ? [] : [{ key: "salesperson", kind: "text" as const }]),
          { key: "fromFollowUp", kind: "text" },
        ],
        rows.map((row) => ({
          href: profileHref(row.customer),
          cells: {
            billDate: isoDate(row.billDate),
            customer: row.customer.name,
            billNumber: row.billNumber,
            amount: row.billAmount === null ? null : Number(row.billAmount),
            salesperson: row.salesperson.fullName,
            fromFollowUp: t(row.fromFollowUp ? "reports.yes" : "reports.no"),
          },
        })),
        total,
      ),
    };
  },
};

// ---------- get_salesperson_stats ----------

const statsArgs = z.object({ from: day, to: day, salespersonName: text, branchName: text });

// The Store overview's own table (M12), so the answer and R2 agree for the same days.
const getSalespersonStats: AskToolDef = {
  name: "get_salesperson_stats",
  description:
    "Per salesperson for a period: visits recorded, new customers, follow-ups due and done, overdue now, sales, sales from follow-ups (conversions), not-interested closures, conversion %. Use for 'how did Amit do this month'.",
  parameters: schema({
    from: nullable("string", "First day, YYYY-MM-DD. Default: 1st of this month."),
    to: nullable("string", "Last day, YYYY-MM-DD. Default: today."),
    salespersonName: nullable("string", "Only this salesperson."),
    branchName: branchNameParam,
  }),
  roles: ["SALESPERSON", "MANAGER", "ADMIN"],
  run: async (raw, actor, t) => {
    const args = statsArgs.parse(raw);
    const range = periodOf(args.from, args.to, actor.today);
    if (typeof range === "string") return refuse(range);
    const staff = await staffNamed(actor, args.salespersonName);
    if ("error" in staff) return refuse(staff.error);
    const named = await branchNamed(actor, args.branchName);
    if ("error" in named) return refuse(named.error);
    const overview = await loadOverview(named.scope, range, actor.today, actor.locale);
    const people = overview.people.filter((p) => !staff.ids || staff.ids.includes(p.id));
    return {
      total: people.length,
      forModel: {
        from: range.from,
        to: range.to,
        people: people.map((p) => ({
          name: p.name,
          active: p.active,
          visits: p.visits,
          newCustomers: p.newCustomers,
          followUpsDue: p.due,
          followUpsDone: p.done,
          overdueNow: p.overdue,
          sales: p.sales,
          salesFromFollowUps: p.conversions,
          notInterested: p.notInterested,
          conversionPercent: p.conversionPercent,
        })),
      },
      table: table(
        t,
        actor.locale,
        "staff",
        [
          { key: "salesperson", kind: "text" },
          { key: "visits", kind: "number" },
          { key: "due", kind: "number" },
          { key: "done", kind: "number" },
          { key: "overdue", kind: "number" },
          { key: "sales", kind: "number" },
          { key: "conversions", kind: "number" },
          { key: "conversionPercent", kind: "percent" },
        ],
        people.map((p) => ({
          ...(actor.self ? {} : { href: `/follow-ups?assignedTo=${p.id}` }),
          cells: {
            salesperson: p.name,
            visits: p.visits,
            due: p.due,
            done: p.done,
            overdue: p.overdue,
            sales: p.sales,
            conversions: p.conversions,
            conversionPercent: p.conversionPercent,
          },
        })),
        people.length,
      ),
    };
  },
};

// ---------- get_lost_reasons ----------

const lostArgs = z.object({ from: day, to: day, branchName: text });

// Report R7's own summary, so the answer and the report agree.
const getLostReasons: AskToolDef = {
  name: "get_lost_reasons",
  description:
    "Why customers said no (not interested) in a period: each reason with its count and share, most common first.",
  parameters: schema({
    from: nullable("string", "First day, YYYY-MM-DD. Default: 1st of this month."),
    to: nullable("string", "Last day, YYYY-MM-DD. Default: today."),
    branchName: branchNameParam,
  }),
  roles: ["MANAGER", "ADMIN"],
  run: async (raw, actor, t) => {
    const args = lostArgs.parse(raw);
    const range = periodOf(args.from, args.to, actor.today);
    if (typeof range === "string") return refuse(range);
    const named = await branchNamed(actor, args.branchName);
    if ("error" in named) return refuse(named.error);
    const result = await REPORTS.r7.run({
      scope: named.scope,
      range,
      today: actor.today,
      filters: parseFilters({}),
      self: actor.self,
      locale: actor.locale,
    });
    const summary = result.tables.find((tbl) => tbl.key === "summary");
    const rows = summary?.rows ?? [];
    const total = Number(summary?.totals?.["count"] ?? 0);
    return {
      total: rows.length,
      forModel: {
        from: range.from,
        to: range.to,
        notInterested: total,
        reasons: rows.map((row) => ({
          reason: row.cells["reason"],
          count: row.cells["count"],
          percent: row.cells["share"],
        })),
      },
      table: table(
        t,
        actor.locale,
        "reasons",
        [
          { key: "reason", kind: "text" },
          { key: "count", kind: "number" },
          { key: "share", kind: "percent" },
        ],
        rows,
        rows.length,
      ),
    };
  },
};

// ---------- get_dashboard ----------

const dashboardArgs = z.object({ from: day, to: day, branchName: text });

const getDashboard: AskToolDef = {
  name: "get_dashboard",
  description:
    "The Store overview figures for a period: customers visited (new / existing), sales and sales from follow-ups, follow-ups due and done, overdue now, not interested and the top reason, conversion %.",
  parameters: schema({
    from: nullable("string", "First day, YYYY-MM-DD. Default: 1st of this month."),
    to: nullable("string", "Last day, YYYY-MM-DD. Default: today."),
    branchName: branchNameParam,
  }),
  roles: ["MANAGER", "ADMIN"],
  run: async (raw, actor, t) => {
    const args = dashboardArgs.parse(raw);
    const range = periodOf(args.from, args.to, actor.today);
    if (typeof range === "string") return refuse(range);
    const named = await branchNamed(actor, args.branchName);
    if ("error" in named) return refuse(named.error);
    const { branch } = named;
    const o = await loadOverview(named.scope, range, actor.today, actor.locale);
    const figures: [string, number | string | null, ColumnKind][] = [
      ["visited", o.visited.total, "number"],
      ["newCustomers", o.visited.new, "number"],
      ["existing", o.visited.existing, "number"],
      ["sales", o.sales.total, "number"],
      ["fromFollowUps", o.sales.fromFollowUps, "number"],
      ["due", o.due.total, "number"],
      ["done", o.due.done, "number"],
      ["overdue", o.overdue, "number"],
      ["notInterested", o.notInterested.total, "number"],
      ["topReason", o.notInterested.topReason, "text"],
      ["conversionPercent", o.conversionPercent, "percent"],
    ];
    return {
      total: figures.length,
      forModel: {
        from: range.from,
        to: range.to,
        branch: branch ?? "the branches on screen",
        customersVisited: o.visited.total,
        newCustomers: o.visited.new,
        existingCustomers: o.visited.existing,
        sales: o.sales.total,
        salesFromFollowUps: o.sales.fromFollowUps,
        followUpsDue: o.due.total,
        followUpsDone: o.due.done,
        overdueNow: o.overdue,
        notInterested: o.notInterested.total,
        topNotInterestedReason: o.notInterested.topReason,
        conversionPercent: o.conversionPercent,
      },
      table: {
        key: "dashboard",
        title: branch ? `${t("ask.tables.dashboard")} · ${branch}` : t("ask.tables.dashboard"),
        columns: [
          { label: t("ask.columns.figure"), numeric: false },
          { label: t("ask.columns.value"), numeric: true },
        ],
        rows: figures.map(([key, value, kind]) => ({
          cells: [
            t(`ask.figures.${key}`),
            formatCell({ key, kind, label: "" }, value, actor.locale) || "—",
          ],
        })),
      },
    };
  },
};

// ---------- the registry ----------

export const ASK_TOOLS: AskToolDef[] = [
  findFollowUps,
  findCustomers,
  getSales,
  getSalespersonStats,
  getLostReasons,
  getDashboard,
];

// A salesperson is offered only the searches about their own work; the store-wide
// figures are a manager's (SOW permission table).
export function askToolsFor(role: Role): ToolDefinition[] {
  return ASK_TOOLS.filter((tool) => tool.roles.includes(role)).map(
    ({ name, description, parameters }) => ({ name, description, parameters }),
  );
}

// Runs one search the model asked for. Anything wrong — an unknown or forbidden search,
// arguments that are not JSON or do not fit — goes back to the model as an error for it
// to explain, never as a crash.
export async function runAskTool(
  name: string,
  rawArguments: string,
  actor: AskActor,
  t: AskText,
): Promise<ToolOutcome> {
  const tool = ASK_TOOLS.find((candidate) => candidate.name === name);
  if (!tool || !tool.roles.includes(actor.user.role)) return refuse(`No search called ${name}.`);
  let args: unknown;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return refuse("The search filters were not valid JSON.");
  }
  try {
    const outcome = await tool.run(args, actor, t);
    // Said on every result a salesperson gets, so the model cannot pass their own
    // customers off as a colleague's.
    if (actor.self && !outcome.error && outcome.forModel && typeof outcome.forModel === "object") {
      outcome.forModel = { ...outcome.forModel, whose: "only the asker's own records" };
    }
    return outcome;
  } catch (error) {
    if (error instanceof z.ZodError)
      return refuse(`Bad filters: ${error.issues[0]?.message ?? ""}`);
    throw error;
  }
}
