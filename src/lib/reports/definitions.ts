// M13: the standard reports (SOW section 7). R2 and R9 are built from the Store
// overview's own figures (src/lib/dashboard.ts), so a report and the dashboard can never
// disagree about the same period. The row lists (R1, R3–R5, R7) use the same definitions.
//
// R10 (WhatsApp and campaigns) arrived with M23; R11 (AI usage) comes with M20, which is
// what writes its data — until then there is nothing true to count.
import type { Prisma, WhatsAppKind } from "@/generated/prisma/client";
import { campaignResultsMany } from "@/lib/campaigns/results";
import { customerTimeline } from "@/lib/customers";
import { loadOverview, percent } from "@/lib/dashboard";
import { dateWhere, instantWhere } from "@/lib/dashboard-period";
import { db } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { formatDate, formatDayDate, isoDate } from "@/lib/format";
import { localizedName } from "@/lib/localized-name";
import { reportTranslators } from "@/lib/messages";
import { normalizeMobile } from "@/lib/mobile";
import { branchWhere, branchWhereShared } from "@/lib/permissions";
import type {
  Column,
  ColumnKind,
  ReportCode,
  ReportDef,
  ReportResult,
  ReportTable,
  Row,
  RunContext,
} from "@/lib/reports/core";
import { readReassignDetail, systemByline, TIMELINE } from "@/lib/timeline";

type T = Awaited<ReturnType<typeof reportTranslators>>["t"];

const tr = async (ctx: RunContext) => (await reportTranslators(ctx.locale)).t;

function columns(t: T, spec: [key: string, kind: ColumnKind][]): Column[] {
  return spec.map(([key, kind]) => ({
    key,
    kind,
    label: t(`columns.${key}` as Parameters<T>[0]),
  }));
}

// The person filter: a salesperson is always themselves (M13.03); otherwise the chosen
// salesperson, and/or everyone in the chosen department.
function personWhere(ctx: RunContext): Prisma.UserWhereInput | undefined {
  const { filters } = ctx;
  if (ctx.self) return { id: ctx.self };
  if (!filters.salesperson && !filters.department) return undefined;
  return {
    ...(filters.salesperson ? { id: filters.salesperson } : {}),
    ...(filters.department ? { departmentId: filters.department } : {}),
  };
}

// A privacy-deleted customer (M16.03) has no profile any more; their rows stay, unlinked.
const profile = (customer: { id: string; active: boolean }) =>
  customer.active ? `/customers/${customer.id}` : undefined;

// R1 Customer visits.
const r1: ReportDef = {
  code: "r1",
  roles: ["MANAGER", "ADMIN"],
  dateRange: true,
  filters: ["salesperson", "department", "visitType", "outcome"],
  defaultSort: { key: "date", dir: "desc" },
  run: async (ctx) => {
    const t = await tr(ctx);
    const person = personWhere(ctx);
    const visits = await db.visit.findMany({
      where: {
        ...branchWhere(ctx.scope),
        visitAt: instantWhere(ctx.range),
        ...(person ? { salesperson: person } : {}),
        ...(ctx.filters.visitType ? { visitType: ctx.filters.visitType } : {}),
        ...(ctx.filters.outcome ? { outcome: ctx.filters.outcome } : {}),
      },
      select: {
        visitAt: true,
        visitType: true,
        outcome: true,
        customer: { select: { id: true, name: true, mobile: true, active: true } },
        enquiry: { select: { title: true } },
        salesperson: { select: { fullName: true } },
      },
    });
    const customers = new Set(visits.map((visit) => visit.customer.id)).size;
    return {
      tables: [
        {
          key: "visits",
          main: true,
          columns: columns(t, [
            ["date", "datetime"],
            ["customer", "text"],
            ["mobile", "mobile"],
            ["visitType", "text"],
            ["requirement", "text"],
            ["outcome", "text"],
            ["salesperson", "text"],
          ]),
          rows: visits.map((visit) => ({
            href: profile(visit.customer),
            cells: {
              date: visit.visitAt.toISOString(),
              customer: visit.customer.name,
              mobile: visit.customer.mobile,
              visitType: t(`enums.visitType.${visit.visitType}`),
              requirement: visit.enquiry.title,
              outcome: t(`enums.outcome.${visit.outcome}`),
              salesperson: visit.salesperson.fullName,
            },
          })),
          totals: {
            date: t("total"),
            customer: t("totals.visits", { count: visits.length, customers }),
          },
        },
      ],
    };
  },
};

// R2 Salesperson summary — the dashboard's table for the chosen days.
const r2: ReportDef = {
  code: "r2",
  roles: ["SALESPERSON", "MANAGER", "ADMIN"],
  dateRange: true,
  filters: ["department"],
  defaultSort: { key: "salesperson", dir: "asc" },
  run: async (ctx) => {
    const t = await tr(ctx);
    const overview = await loadOverview(ctx.scope, ctx.range, ctx.today, ctx.locale);
    const people = overview.people.filter(
      (person) =>
        (!ctx.self || person.id === ctx.self) &&
        (!ctx.filters.department || person.departmentId === ctx.filters.department),
    );
    const sum = (pick: (p: (typeof people)[number]) => number) =>
      people.reduce((total, person) => total + pick(person), 0);
    const closed = sum((p) => p.sales + p.notInterested);
    return {
      tables: [
        {
          key: "people",
          main: true,
          columns: columns(t, [
            ["salesperson", "text"],
            ["visits", "number"],
            ["newCustomers", "number"],
            ["due", "number"],
            ["done", "number"],
            ["overdue", "number"],
            ["sales", "number"],
            ["conversions", "number"],
            ["conversionPercent", "percent"],
          ]),
          rows: people.map((person) => ({
            href: `/follow-ups?assignedTo=${person.id}`,
            cells: {
              salesperson: person.active ? person.name : t("inactiveName", { name: person.name }),
              visits: person.visits,
              newCustomers: person.newCustomers,
              due: person.due,
              done: person.done,
              overdue: person.overdue,
              sales: person.sales,
              conversions: person.conversions,
              conversionPercent: person.conversionPercent,
            },
          })),
          totals: {
            salesperson: t("total"),
            visits: sum((p) => p.visits),
            newCustomers: sum((p) => p.newCustomers),
            due: sum((p) => p.due),
            done: sum((p) => p.done),
            overdue: sum((p) => p.overdue),
            sales: sum((p) => p.sales),
            conversions: sum((p) => p.conversions),
            conversionPercent: percent(
              sum((p) => p.conversions),
              closed,
            ),
          },
        },
      ],
    };
  },
};

// R3 Follow-ups due in the period. "Overdue" is a pending one due before today.
const r3: ReportDef = {
  code: "r3",
  roles: ["SALESPERSON", "MANAGER", "ADMIN"],
  dateRange: true,
  filters: ["salesperson", "status"],
  defaultSort: { key: "dueDate", dir: "asc" },
  run: async (ctx) => {
    const { t, tFollowUps, tResult } = await reportTranslators(ctx.locale);
    const today = calendarDay(ctx.today);
    const status: Prisma.FollowUpWhereInput = {
      pending: { status: "PENDING" as const, dueDate: { gte: today } },
      overdue: { status: "PENDING" as const, dueDate: { lt: today } },
      done: { status: "DONE" as const },
      rescheduled: { status: "RESCHEDULED" as const },
      cancelled: { status: "CANCELLED" as const },
      none: {},
    }[ctx.filters.status ?? "none"];
    const person = personWhere(ctx);
    const followUps = await db.followUp.findMany({
      where: {
        AND: [
          // A salesperson's own follow-ups are theirs in every branch (M11), so their
          // scope is them; everyone else's is the switcher's branches.
          ctx.self ? { assignedToId: ctx.self } : branchWhere(ctx.scope),
          { dueDate: dateWhere(ctx.range) },
          person && !ctx.self ? { assignedTo: person } : {},
          status,
        ],
      },
      select: {
        id: true,
        dueDate: true,
        timeSlot: true,
        method: true,
        status: true,
        result: true,
        completedAt: true,
        customer: { select: { id: true, name: true, mobile: true, active: true } },
        enquiry: { select: { title: true } },
        assignedTo: { select: { fullName: true } },
      },
    });
    const label = (row: (typeof followUps)[number]) =>
      row.status === "PENDING" && row.dueDate < today
        ? t("enums.status.overdue")
        : t(`enums.status.${row.status.toLowerCase() as "pending"}`);
    return {
      tables: [
        {
          key: "followUps",
          main: true,
          columns: columns(t, [
            ["dueDate", "day"],
            ["slot", "text"],
            ["customer", "text"],
            ["mobile", "mobile"],
            ["requirement", "text"],
            ["method", "text"],
            ["status", "text"],
            ["result", "text"],
            ["doneOn", "day"],
            ["salesperson", "text"],
          ]),
          rows: followUps.map((row) => ({
            href: profile(row.customer),
            cells: {
              dueDate: isoDate(row.dueDate),
              slot: tFollowUps(`slot.${row.timeSlot}`),
              customer: row.customer.name,
              mobile: row.customer.mobile,
              requirement: row.enquiry.title,
              method: tFollowUps(`method.${row.method}`),
              status: label(row),
              result: row.result ? tResult(`option.${row.result}.label`) : null,
              doneOn: row.completedAt ? isoDate(row.completedAt) : null,
              salesperson: row.assignedTo.fullName,
            },
          })),
          totals: {
            dueDate: t("total"),
            customer: t("totals.followUps", { count: followUps.length }),
          },
        },
      ],
    };
  },
};

// R4 Follow-up conversion: sales in the period that came from follow-ups (BR-11).
const r4: ReportDef = {
  code: "r4",
  roles: ["MANAGER", "ADMIN"],
  dateRange: true,
  filters: ["salesperson"],
  defaultSort: { key: "saleDate", dir: "desc" },
  run: async (ctx) => {
    const t = await tr(ctx);
    const person = personWhere(ctx);
    const sales = await db.sale.findMany({
      where: {
        ...branchWhere(ctx.scope),
        billDate: dateWhere(ctx.range),
        cancelled: false,
        fromFollowUp: true,
        ...(person ? { salesperson: person } : {}),
      },
      select: {
        billDate: true,
        billNumber: true,
        customer: { select: { id: true, name: true, active: true } },
        salesperson: { select: { fullName: true } },
        enquiry: {
          select: {
            title: true,
            _count: { select: { followUps: { where: { status: "DONE" } } } },
            visits: { orderBy: { visitAt: "asc" }, take: 1, select: { visitAt: true } },
          },
        },
      },
    });
    const rows: Row[] = sales.map((sale) => {
      const first = sale.enquiry.visits[0]?.visitAt;
      const saleDay = isoDate(sale.billDate);
      return {
        href: profile(sale.customer),
        cells: {
          customer: sale.customer.name,
          enquiry: sale.enquiry.title,
          followUps: sale.enquiry._count.followUps,
          firstVisit: first ? isoDate(first) : null,
          saleDate: saleDay,
          billNumber: sale.billNumber,
          daysToConvert: first ? Math.max(0, daysBetween(isoDate(first), saleDay)) : null,
          salesperson: sale.salesperson.fullName,
        },
      };
    });
    const days = rows
      .map((row) => row.cells.daysToConvert)
      .filter((value): value is number => typeof value === "number");
    return {
      tables: [
        {
          key: "conversions",
          main: true,
          columns: columns(t, [
            ["customer", "text"],
            ["enquiry", "text"],
            ["followUps", "number"],
            ["firstVisit", "day"],
            ["saleDate", "day"],
            ["billNumber", "text"],
            ["daysToConvert", "number"],
            ["salesperson", "text"],
          ]),
          rows,
          totals: {
            customer: t("totals.conversions", { count: rows.length }),
            daysToConvert: days.length
              ? Math.round(days.reduce((a, b) => a + b, 0) / days.length)
              : null,
            salesperson: days.length ? t("totals.averageDays") : null,
          },
        },
      ],
    };
  },
};

// R5 Sales and bill numbers.
const r5: ReportDef = {
  code: "r5",
  roles: ["MANAGER", "ADMIN"],
  dateRange: true,
  filters: ["salesperson", "fromFollowUp", "cancelled"],
  defaultSort: { key: "billDate", dir: "desc" },
  run: async (ctx) => {
    const t = await tr(ctx);
    const person = personWhere(ctx);
    const { fromFollowUp, cancelled } = ctx.filters;
    const sales = await db.sale.findMany({
      where: {
        ...branchWhere(ctx.scope),
        billDate: dateWhere(ctx.range),
        ...(cancelled === "yes" ? {} : { cancelled: false }),
        ...(fromFollowUp ? { fromFollowUp: fromFollowUp === "yes" } : {}),
        ...(person ? { salesperson: person } : {}),
      },
      select: {
        billDate: true,
        billNumber: true,
        billAmount: true,
        fromFollowUp: true,
        cancelled: true,
        customer: { select: { id: true, name: true, mobile: true, active: true } },
        salesperson: { select: { fullName: true } },
      },
    });
    const yesNo = (value: boolean) => (value ? t("yes") : t("no"));
    const counted = sales.filter((sale) => !sale.cancelled);
    return {
      tables: [
        {
          key: "sales",
          main: true,
          columns: columns(t, [
            ["billDate", "day"],
            ["billNumber", "text"],
            ["customer", "text"],
            ["mobile", "mobile"],
            ["amount", "money"],
            ["salesperson", "text"],
            ["fromFollowUp", "text"],
            ["cancelled", "text"],
          ]),
          rows: sales.map((sale) => ({
            href: profile(sale.customer),
            cells: {
              billDate: isoDate(sale.billDate),
              billNumber: sale.billNumber,
              customer: sale.customer.name,
              mobile: sale.customer.mobile,
              amount: sale.billAmount === null ? null : Number(sale.billAmount),
              salesperson: sale.salesperson.fullName,
              fromFollowUp: yesNo(sale.fromFollowUp),
              cancelled: yesNo(sale.cancelled),
            },
          })),
          // Cancelled sales are listed when asked for, never added up.
          totals: {
            billDate: t("total"),
            customer: t("totals.sales", {
              count: counted.length,
              fromFollowUps: counted.filter((sale) => sale.fromFollowUp).length,
            }),
            amount: counted.reduce((sum, sale) => sum + Number(sale.billAmount ?? 0), 0),
          },
        },
      ],
    };
  },
};

// R6 New vs existing customers, day by day: the dashboard's "customers visited" for each
// day of the period.
const r6: ReportDef = {
  code: "r6",
  roles: ["MANAGER", "ADMIN"],
  dateRange: true,
  filters: ["department"],
  defaultSort: { key: "date", dir: "asc" },
  run: async (ctx) => {
    const t = await tr(ctx);
    const person = personWhere(ctx);
    const visits = await db.visit.findMany({
      where: {
        ...branchWhere(ctx.scope),
        visitAt: instantWhere(ctx.range),
        ...(person ? { salesperson: person } : {}),
      },
      select: { visitAt: true, customerId: true, visitType: true },
    });
    // day → customer → new?
    const days = new Map<string, Map<string, boolean>>();
    for (const visit of visits) {
      const day = isoDate(visit.visitAt);
      const customers = days.get(day) ?? new Map<string, boolean>();
      customers.set(
        visit.customerId,
        (customers.get(visit.customerId) ?? false) || visit.visitType === "NEW",
      );
      days.set(day, customers);
    }
    const rows: Row[] = [];
    for (let day = ctx.range.from; day <= ctx.range.to; day = addDays(day, 1)) {
      const customers = [...(days.get(day)?.values() ?? [])];
      const fresh = customers.filter(Boolean).length;
      rows.push({
        cells: {
          date: day,
          new: fresh,
          existing: customers.length - fresh,
          total: customers.length,
        },
      });
    }
    const sum = (key: string) => rows.reduce((total, row) => total + Number(row.cells[key]), 0);
    return {
      tables: [
        {
          key: "days",
          main: true,
          columns: columns(t, [
            ["date", "day"],
            ["new", "number"],
            ["existing", "number"],
            ["total", "number"],
          ]),
          rows,
          totals: {
            date: t("total"),
            new: sum("new"),
            existing: sum("existing"),
            total: sum("total"),
          },
        },
      ],
      chart: rows.map((row) => ({
        label: formatDayDate(new Date(`${row.cells.date}T12:00:00.000Z`), ctx.locale),
        values: [
          { key: "new", label: t("columns.new"), value: Number(row.cells.new) },
          { key: "existing", label: t("columns.existing"), value: Number(row.cells.existing) },
        ],
      })),
    };
  },
};

// R7 Not-interested reasons: every enquiry closed as not interested in the period, by a
// visit or by a follow-up call (the same count as the dashboard's tile).
const r7: ReportDef = {
  code: "r7",
  roles: ["MANAGER", "ADMIN"],
  dateRange: true,
  filters: ["salesperson", "reason"],
  defaultSort: { key: "date", dir: "desc" },
  run: async (ctx) => {
    const t = await tr(ctx);
    const person = personWhere(ctx);
    const reason = ctx.filters.reason;
    const instants = instantWhere(ctx.range);
    const names = { select: { nameEn: true, nameHi: true, nameGu: true, id: true } };
    const [visits, calls] = await Promise.all([
      db.visit.findMany({
        where: {
          ...branchWhere(ctx.scope),
          visitAt: instants,
          outcome: "NOT_INTERESTED",
          ...(person ? { salesperson: person } : {}),
          ...(reason ? { lostReasonId: reason } : {}),
        },
        select: {
          visitAt: true,
          remarks: true,
          lostReason: names,
          customer: { select: { id: true, name: true, active: true } },
          enquiry: { select: { title: true } },
          salesperson: { select: { fullName: true } },
        },
      }),
      db.followUp.findMany({
        where: {
          ...branchWhere(ctx.scope),
          result: "NOT_INTERESTED",
          completedAt: instants,
          ...(person ? { completedBy: person } : {}),
          ...(reason ? { enquiry: { lostReasonId: reason } } : {}),
        },
        select: {
          completedAt: true,
          resultNote: true,
          customer: { select: { id: true, name: true, active: true } },
          enquiry: { select: { title: true, lostReason: names } },
          completedBy: { select: { fullName: true } },
        },
      }),
    ]);
    const detail = [
      ...visits.map((visit) => ({
        at: visit.visitAt,
        customer: visit.customer,
        requirement: visit.enquiry.title,
        reason: visit.lostReason,
        remarks: visit.remarks,
        salesperson: visit.salesperson.fullName,
      })),
      ...calls.map((call) => ({
        at: call.completedAt!,
        customer: call.customer,
        requirement: call.enquiry.title,
        reason: call.enquiry.lostReason,
        remarks: call.resultNote,
        salesperson: call.completedBy?.fullName ?? "",
      })),
    ];
    const reasonName = (row: (typeof detail)[number]) =>
      row.reason ? localizedName(row.reason, ctx.locale) : t("noReason");
    const byReason = new Map<string, number>();
    for (const row of detail)
      byReason.set(reasonName(row), (byReason.get(reasonName(row)) ?? 0) + 1);

    return {
      tables: [
        {
          key: "summary",
          title: t("r7.summary"),
          columns: columns(t, [
            ["reason", "text"],
            ["count", "number"],
            ["share", "percent"],
          ]),
          rows: [...byReason]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({
              cells: { reason: name, count, share: percent(count, detail.length) },
            })),
          totals: { reason: t("total"), count: detail.length, share: detail.length ? 100 : null },
        },
        {
          key: "detail",
          title: t("r7.detail"),
          main: true,
          columns: columns(t, [
            ["date", "datetime"],
            ["customer", "text"],
            ["requirement", "text"],
            ["reason", "text"],
            ["remarks", "text"],
            ["salesperson", "text"],
          ]),
          rows: detail.map((row) => ({
            href: profile(row.customer),
            cells: {
              date: row.at.toISOString(),
              customer: row.customer.name,
              requirement: row.requirement,
              reason: reasonName(row),
              remarks: row.remarks,
              salesperson: row.salesperson,
            },
          })),
        },
      ],
    };
  },
};

// R8 Customer history: one customer's whole timeline, found by mobile. Customers are
// shared across branches (BR-16), so this is not narrowed to the switcher.
const r8: ReportDef = {
  code: "r8",
  roles: ["MANAGER", "ADMIN"],
  dateRange: false,
  filters: ["mobile"],
  defaultSort: { key: "when", dir: "desc" },
  run: async (ctx) => {
    const { t, tAll, tFollowUps } = await reportTranslators(ctx.locale);
    const mobile = ctx.filters.mobile ? normalizeMobile(ctx.filters.mobile) : null;
    const customer = mobile
      ? await db.customer.findUnique({ where: { mobile }, select: { id: true, name: true } })
      : null;
    if (!customer) {
      return { tables: [], empty: ctx.filters.mobile ? t("r8.notFound") : t("r8.pick") };
    }
    const { events } = await customerTimeline(customer.id, R8_MAX_EVENTS);
    const title = (key: string) =>
      tAll.has(key as Parameters<typeof tAll>[0]) ? tAll(key as Parameters<typeof tAll>[0]) : key;
    const heading = (event: (typeof events)[number]) => {
      const names =
        event.type === TIMELINE.reassigned.type ? readReassignDetail(event.detail) : null;
      if (names) return tAll("timeline.reassignedFromTo", names);
      if (event.type === TIMELINE.imported.type)
        return tAll("timeline.importedOnBy", {
          date: formatDate(event.createdAt, ctx.locale),
          name: event.staffName ?? "",
        });
      const key =
        event.type === TIMELINE.followUpSet.type ? "timeline.followUpSetFor" : event.title;
      if (!event.followUp || !tAll.has(key as Parameters<typeof tAll>[0]))
        return title(event.title);
      return tAll(key as Parameters<typeof tAll>[0], {
        date: formatDayDate(event.followUp.dueDate, ctx.locale),
        slot: tFollowUps(`slotWord.${event.followUp.timeSlot}`),
      });
    };
    return {
      tables: [
        {
          key: "history",
          title: customer.name,
          main: true,
          columns: columns(t, [
            ["when", "datetime"],
            ["event", "text"],
            ["remarks", "text"],
            ["staff", "text"],
            ["branch", "text"],
          ]),
          rows: events.map((event) => ({
            cells: {
              when: event.createdAt.toISOString(),
              event: heading(event),
              remarks: event.type === TIMELINE.reassigned.type ? null : event.detail,
              staff:
                event.staffName ?? tAll(systemByline(event.type) as Parameters<typeof tAll>[0]),
              branch: event.branchName,
            },
          })),
        },
      ],
    };
  },
};

// A customer's whole life on one page; far beyond any real history.
export const R8_MAX_EVENTS = 1_000;

// R9 Branch comparison (admin): the dashboard's figures, one branch per row.
const r9: ReportDef = {
  code: "r9",
  roles: ["ADMIN"],
  dateRange: true,
  filters: [],
  defaultSort: { key: "branch", dir: "asc" },
  run: async (ctx) => {
    const t = await tr(ctx);
    const branches = await db.branch.findMany({
      where: {
        status: "ACTIVE",
        ...(ctx.scope.all ? {} : { id: { in: ctx.scope.branchIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const figures = await Promise.all(
      branches.map((branch) =>
        loadOverview({ all: false, branchIds: [branch.id] }, ctx.range, ctx.today, ctx.locale),
      ),
    );
    const cells = (o: (typeof figures)[number]) => ({
      visits: o.people.reduce((sum, person) => sum + person.visits, 0),
      newCustomers: o.visited.new,
      done: o.due.done,
      overdue: o.overdue,
      sales: o.sales.total,
    });
    const rows: Row[] = branches.map((branch, i) => ({
      cells: {
        branch: branch.name,
        ...cells(figures[i]!),
        conversionPercent: figures[i]!.conversionPercent,
      },
    }));
    const add = (key: string) => rows.reduce((sum, row) => sum + Number(row.cells[key]), 0);
    const conversions = figures.reduce((sum, o) => sum + o.sales.fromFollowUps, 0);
    const closed = figures.reduce((sum, o) => sum + o.sales.total + o.notInterested.total, 0);
    return {
      tables: [
        {
          key: "branches",
          main: true,
          columns: columns(t, [
            ["branch", "text"],
            ["visits", "number"],
            ["newCustomers", "number"],
            ["done", "number"],
            ["overdue", "number"],
            ["sales", "number"],
            ["conversionPercent", "percent"],
          ]),
          rows,
          totals: {
            branch: t("total"),
            visits: add("visits"),
            newCustomers: add("newCustomers"),
            done: add("done"),
            overdue: add("overdue"),
            sales: add("sales"),
            conversionPercent: percent(conversions, closed),
          },
        },
      ],
    };
  },
};

// R10 WhatsApp and campaigns (M23): outgoing messages of the period by what sent them,
// with their ticks, then every campaign scheduled in the period with its results — the
// same numbers as the campaign's own page (src/lib/campaigns/results.ts).
const MESSAGE_KINDS = [
  "TEMPLATE",
  "TEXT",
  "THANK_YOU",
  "VISIT_REMINDER",
  "OCCASION",
  "CAMPAIGN",
] as const satisfies readonly WhatsAppKind[];

const r10: ReportDef = {
  code: "r10",
  roles: ["MANAGER", "ADMIN"],
  dateRange: true,
  filters: [],
  defaultSort: { key: "scheduledAt", dir: "desc" },
  run: async (ctx) => {
    const { t, tAll } = await reportTranslators(ctx.locale);
    const instants = instantWhere(ctx.range);
    const [outgoing, incoming, campaigns] = await Promise.all([
      db.whatsAppMessage.groupBy({
        by: ["kind", "status"],
        where: { ...branchWhere(ctx.scope), direction: "OUT", createdAt: instants },
        _count: { _all: true },
      }),
      db.whatsAppMessage.count({
        where: { ...branchWhere(ctx.scope), direction: "IN", createdAt: instants },
      }),
      db.campaign.findMany({
        where: {
          AND: [branchWhereShared(ctx.scope), { scheduledAt: instants }],
        },
        select: {
          id: true,
          name: true,
          status: true,
          scheduledAt: true,
          branch: { select: { name: true } },
        },
      }),
    ]);
    const kindRows: Row[] = MESSAGE_KINDS.map((kind) => {
      const of = (status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED") =>
        outgoing.find((row) => row.kind === kind && row.status === status)?._count._all ?? 0;
      const sent = of("SENT") + of("DELIVERED") + of("READ");
      return {
        cells: {
          kind: t(`r10.kind.${kind}`),
          messages: sent + of("QUEUED") + of("FAILED"),
          sent,
          delivered: of("DELIVERED") + of("READ"),
          read: of("READ"),
          failed: of("FAILED"),
        },
      };
    });
    const sum = (key: string) => kindRows.reduce((total, row) => total + Number(row.cells[key]), 0);
    const results = await campaignResultsMany(campaigns.map((campaign) => campaign.id));
    const campaignRows: Row[] = campaigns.map((campaign) => {
      const r = results.get(campaign.id)!.totals;
      return {
        href: `/campaigns/${campaign.id}`,
        cells: {
          scheduledAt: campaign.scheduledAt.toISOString(),
          campaign: campaign.name,
          branch: campaign.branch?.name ?? t("allBranches"),
          status: tAll(`campaigns.status.${campaign.status}`),
          recipients: r.recipients,
          sent: r.sent,
          delivered: r.delivered,
          read: r.read,
          replied: r.replied,
          visited: r.visited,
          bought: r.bought,
        },
      };
    });
    const total = (key: string) =>
      campaignRows.reduce((sum, row) => sum + Number(row.cells[key]), 0);
    const tables: ReportTable[] = [
      {
        key: "kinds",
        title: t("r10.messages"),
        columns: columns(t, [
          ["kind", "text"],
          ["messages", "number"],
          ["sent", "number"],
          ["delivered", "number"],
          ["read", "number"],
          ["failed", "number"],
        ]),
        rows: [
          ...kindRows,
          {
            cells: {
              kind: t("r10.incoming"),
              messages: incoming,
              sent: null,
              delivered: null,
              read: null,
              failed: null,
            },
          },
        ],
        totals: {
          kind: t("total"),
          messages: sum("messages") + incoming,
          sent: sum("sent"),
          delivered: sum("delivered"),
          read: sum("read"),
          failed: sum("failed"),
        },
      },
      {
        key: "campaigns",
        title: t("r10.campaigns"),
        main: true,
        columns: columns(t, [
          ["scheduledAt", "datetime"],
          ["campaign", "text"],
          ["branch", "text"],
          ["status", "text"],
          ["recipients", "number"],
          ["sent", "number"],
          ["delivered", "number"],
          ["read", "number"],
          ["replied", "number"],
          ["visited", "number"],
          ["bought", "number"],
        ]),
        rows: campaignRows,
        totals: {
          scheduledAt: t("total"),
          campaign: t("totals.campaigns", { count: campaignRows.length }),
          recipients: total("recipients"),
          sent: total("sent"),
          delivered: total("delivered"),
          read: total("read"),
          replied: total("replied"),
          visited: total("visited"),
          bought: total("bought"),
        },
      },
    ];
    return { tables };
  },
};

export const REPORTS: Record<ReportCode, ReportDef> = {
  r1,
  r2,
  r3,
  r4,
  r5,
  r6,
  r7,
  r8,
  r9,
  r10,
};

export type { ReportResult };
