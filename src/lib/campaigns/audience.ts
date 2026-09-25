// Who a campaign goes to (M23): the customers the filters match, and which of them are
// left out — no WhatsApp consent (BR-19), the weekly limit reached (BR-21), or a detail
// the template needs that the customer lacks. The preview on the screen and the worker's
// run call the same code, so the numbers shown before are the numbers found after.
//
// Customers are shared across branches (BR-16); a branch campaign takes the customers
// the branch handles — home branch there, or visited there.
//
// branch-scope-exempt: the weekly limit is per customer, whichever branch sent (BR-21),
// so campaign messages are counted from every branch.
import { createTranslator } from "next-intl";
import type { Language, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays } from "@/lib/follow-up-dates";
import { calendarDay } from "@/lib/follow-ups";
import { loadMessages } from "@/lib/messages";
import type { CampaignFilters } from "@/lib/validation/campaign";
import type { CampaignVariables } from "@/lib/whatsapp/fields";
import { fillCampaignTemplate, firstName, type FieldValues } from "@/lib/whatsapp/templates";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const SAMPLE_SIZE = 10;

export type Audience = { branchId: string | null; filters: CampaignFilters };

export type AudienceCustomer = {
  id: string;
  name: string;
  mobile: string;
  whatsappConsent: boolean;
  occasion: string | null;
  homeBranchId: string;
};

const utcDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const istStart = (value: string) => new Date(`${value}T00:00:00.000+05:30`);

export function audienceWhere(audience: Audience, today: string): Prisma.CustomerWhereInput {
  const f = audience.filters;
  const and: Prisma.CustomerWhereInput[] = [
    { active: true, anonymizedAt: null, mobile: { not: null } },
  ];
  if (audience.branchId) {
    and.push({
      OR: [
        { homeBranchId: audience.branchId },
        { visits: { some: { branchId: audience.branchId } } },
      ],
    });
  }
  if (f.categoryIds.length > 0) {
    and.push({
      enquiries: { some: { categories: { some: { categoryId: { in: f.categoryIds } } } } },
    });
  }
  if (f.departmentId) and.push({ departmentId: f.departmentId });
  // "Last visit between": a visit in the range, and none after it.
  if (f.lastVisitFrom || f.lastVisitTo) {
    and.push({
      visits: {
        some: {
          visitAt: {
            ...(f.lastVisitFrom ? { gte: istStart(f.lastVisitFrom) } : {}),
            ...(f.lastVisitTo ? { lt: istStart(addDays(f.lastVisitTo, 1)) } : {}),
          },
        },
      },
    });
    if (f.lastVisitTo) {
      and.push({
        NOT: { visits: { some: { visitAt: { gte: istStart(addDays(f.lastVisitTo, 1)) } } } },
      });
    }
  }
  if (f.bought) {
    const sale: Prisma.SaleWhereInput = {
      cancelled: false,
      ...(f.boughtFrom || f.boughtTo
        ? {
            billDate: {
              ...(f.boughtFrom ? { gte: utcDay(f.boughtFrom) } : {}),
              ...(f.boughtTo ? { lte: utcDay(f.boughtTo) } : {}),
            },
          }
        : {}),
    };
    and.push(f.bought === "yes" ? { sales: { some: sale } } : { sales: { none: sale } });
  }
  if (f.lostReasonId) {
    and.push({ enquiries: { some: { status: "NOT_INTERESTED", lostReasonId: f.lostReasonId } } });
  }
  if (f.intent) and.push({ enquiries: { some: { intent: f.intent } } });
  if (f.occasionWithinDays) {
    and.push({
      occasionDate: {
        gte: calendarDay(today),
        lte: calendarDay(addDays(today, f.occasionWithinDays)),
      },
    });
  }
  return { AND: and };
}

export async function loadAudience(audience: Audience, today: string): Promise<AudienceCustomer[]> {
  const rows = await db.customer.findMany({
    where: audienceWhere(audience, today),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      mobile: true,
      whatsappConsent: true,
      occasion: true,
      homeBranchId: true,
    },
  });
  return rows.filter((row): row is AudienceCustomer => row.mobile !== null);
}

// BR-21: campaign messages each customer got in the last 7 days (a failed one never
// reached them, so it does not count).
export async function weeklyCampaignCounts(
  customerIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (customerIds.length === 0) return new Map();
  const rows = await db.whatsAppMessage.groupBy({
    by: ["customerId"],
    where: {
      customerId: { in: customerIds },
      kind: "CAMPAIGN",
      direction: "OUT",
      status: { not: "FAILED" },
      createdAt: { gte: new Date(now.getTime() - WEEK_MS) },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.customerId, row._count._all]));
}

// The one customer's count, read just before their message is queued (the worker).
export async function weeklyCampaignCount(customerId: string, now: Date): Promise<number> {
  return db.whatsAppMessage.count({
    where: {
      customerId,
      kind: "CAMPAIGN",
      direction: "OUT",
      status: { not: "FAILED" },
      createdAt: { gte: new Date(now.getTime() - WEEK_MS) },
    },
  });
}

// What the campaign fields are for one customer. Store and branch names are looked up
// once by the caller; the rest is on the customer row.
export type FieldContext = {
  storeName: string;
  branchName: (customer: AudienceCustomer) => string | null;
};

export function campaignFieldValues(customer: AudienceCustomer, ctx: FieldContext): FieldValues {
  return {
    customerFirstName: firstName(customer.name),
    customerName: customer.name,
    storeName: ctx.storeName,
    branchName: ctx.branchName(customer),
    occasion: customer.occasion,
  };
}

export async function storeNameIn(language: Language): Promise<string> {
  const messages = await loadMessages(language);
  return createTranslator({ locale: language, messages, namespace: "app" })("storeName");
}

// Branch names for the placeholder: the campaign's branch, or each customer's home branch
// when the campaign is for every branch.
export async function branchNamer(branchId: string | null): Promise<FieldContext["branchName"]> {
  const branches = await db.branch.findMany({
    where: branchId ? { id: branchId } : {},
    select: { id: true, name: true },
  });
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  return (customer) => names.get(branchId ?? customer.homeBranchId) ?? null;
}

export type AudienceCounts = {
  matched: number;
  noConsent: number;
  weeklyLimit: number;
  missingField: number;
  ready: number;
};

export type Recipient = AudienceCustomer & { values: FieldValues };

export type Preview = {
  counts: AudienceCounts;
  sample: { id: string; name: string; mobile: string }[];
  recipients: Recipient[];
};

// Step 4 of the builder: "412 customers match. 96 skipped (no WhatsApp consent). 18
// skipped (weekly limit)." plus ten of those who would get it.
export async function previewAudience(
  input: Audience & {
    template: { variables: unknown; language: Language };
    variables: CampaignVariables;
    weeklyLimit: number;
  },
  now: Date,
  today: string,
): Promise<Preview> {
  const customers = await loadAudience(input, today);
  const consenting = customers.filter((customer) => customer.whatsappConsent);
  const weekly = await weeklyCampaignCounts(
    consenting.map((customer) => customer.id),
    now,
  );
  const ctx: FieldContext = {
    storeName: await storeNameIn(input.template.language),
    branchName: await branchNamer(input.branchId),
  };
  const counts: AudienceCounts = {
    matched: customers.length,
    noConsent: customers.length - consenting.length,
    weeklyLimit: 0,
    missingField: 0,
    ready: 0,
  };
  const recipients: Recipient[] = [];
  for (const customer of consenting) {
    if ((weekly.get(customer.id) ?? 0) >= input.weeklyLimit) {
      counts.weeklyLimit += 1;
      continue;
    }
    const values = campaignFieldValues(customer, ctx);
    if (!fillCampaignTemplate(input.template, input.variables, values).ok) {
      counts.missingField += 1;
      continue;
    }
    recipients.push({ ...customer, values });
  }
  counts.ready = recipients.length;
  return {
    counts,
    sample: recipients.slice(0, SAMPLE_SIZE).map(({ id, name, mobile }) => ({ id, name, mobile })),
    recipients,
  };
}
