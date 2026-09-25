// WhatsApp templates (M22): synced from Meta, each placeholder mapped to an app field by
// the admin, and filled for one customer when a message is sent.
//
// audit-exempt: templates are Meta's copy, not a business record; the sync and the
// mapping write "setting:update" rows from src/lib/actions/whatsapp.ts.
import type { Language, Prisma, TemplateStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { listTemplates, type MetaTemplate } from "@/lib/whatsapp/meta";
import type { Connection } from "@/lib/whatsapp/settings";

export { TEMPLATE_FIELDS, type TemplateField, type TemplateMapping } from "@/lib/whatsapp/fields";
import type { CampaignVariables, TemplateField, TemplateMapping } from "@/lib/whatsapp/fields";
export type FieldValues = Partial<Record<TemplateField, string | null>>;

// "Hi {{1}}, thanks for visiting {{2}}" → ["1", "2"], in the order Meta numbers them.
export function placeholders(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(match[1]!);
  return [...found].sort((a, b) => Number(a) - Number(b));
}

// Meta spells languages its own way (en_US, en_GB, hi, gu). Anything else is not a
// language the app speaks, and the template is left out.
export function appLanguage(metaCode: string): Language | null {
  const base = metaCode.toLowerCase().split(/[_-]/)[0];
  return base === "en" || base === "hi" || base === "gu" ? base : null;
}

// PAUSED, DISABLED, IN_APPEAL… — only APPROVED can be sent.
export function appStatus(metaStatus: string): TemplateStatus {
  const status = metaStatus.toUpperCase();
  if (status === "APPROVED") return "APPROVED";
  if (status === "PENDING" || status === "IN_APPEAL") return "PENDING";
  return "REJECTED";
}

function bodyOf(template: MetaTemplate): string {
  return template.components?.find((part) => part.type.toUpperCase() === "BODY")?.text ?? "";
}

// Upserts every Meta template in a language the app speaks. Templates gone from Meta are
// switched off, not deleted (old messages point at them). The admin's mapping is kept,
// minus placeholders the new body no longer has.
export async function syncTemplates(
  connection: Connection,
  now = new Date(),
): Promise<{ synced: number; skipped: number }> {
  const remote = await listTemplates(connection);
  let synced = 0;
  let skipped = 0;
  const seen: string[] = [];
  for (const template of remote) {
    const language = appLanguage(template.language);
    if (!language) {
      skipped += 1;
      continue;
    }
    const body = bodyOf(template);
    const variables = placeholders(body);
    const existing = await db.whatsAppTemplate.findUnique({
      where: { name_language: { name: template.name, language } },
      select: { id: true, mapping: true },
    });
    const mapping = Object.fromEntries(
      Object.entries((existing?.mapping ?? {}) as TemplateMapping).filter(([key]) =>
        variables.includes(key),
      ),
    );
    const data = {
      category: template.category.slice(0, 50),
      body,
      variables,
      metaId: template.id,
      metaLanguage: template.language,
      metaStatus: appStatus(template.status),
      metaStatusText: template.status.slice(0, 30),
      mapping: mapping as Prisma.InputJsonValue,
      active: true,
      syncedAt: now,
    };
    const row = existing
      ? await db.whatsAppTemplate.update({ where: { id: existing.id }, data, select: { id: true } })
      : await db.whatsAppTemplate.create({
          data: { name: template.name, language, ...data },
          select: { id: true },
        });
    seen.push(row.id);
    synced += 1;
  }
  await db.whatsAppTemplate.updateMany({
    where: { id: { notIn: seen }, active: true },
    data: { active: false },
  });
  return { synced, skipped };
}

// The values for each placeholder, or the first field this customer has nothing for
// ("this template needs a bill number").
export function fillTemplate(
  template: { variables: unknown; mapping: unknown },
  values: FieldValues,
): { ok: true; parameters: string[] } | { ok: false; missing: TemplateField | "unmapped" } {
  const variables = Array.isArray(template.variables) ? (template.variables as string[]) : [];
  const mapping = (template.mapping ?? {}) as TemplateMapping;
  const parameters: string[] = [];
  for (const variable of variables) {
    const field = mapping[variable];
    if (!field) return { ok: false, missing: "unmapped" };
    const value = values[field]?.trim();
    if (!value) return { ok: false, missing: field };
    parameters.push(value);
  }
  return { ok: true, parameters };
}

// M23: a campaign's own filling — a fixed text for everyone, or a customer field — in
// place of the admin's mapping. Same answer shape as fillTemplate().
export function fillCampaignTemplate(
  template: { variables: unknown },
  variables: CampaignVariables,
  values: FieldValues,
): { ok: true; parameters: string[] } | { ok: false; missing: TemplateField | "unmapped" } {
  const names = Array.isArray(template.variables) ? (template.variables as string[]) : [];
  const parameters: string[] = [];
  for (const name of names) {
    const variable = variables[name];
    if (!variable) return { ok: false, missing: "unmapped" };
    const value = variable.kind === "text" ? variable.text.trim() : values[variable.field]?.trim();
    if (!value)
      return { ok: false, missing: variable.kind === "field" ? variable.field : "unmapped" };
    parameters.push(value);
  }
  return { ok: true, parameters };
}

// The message as the customer will read it, for the preview and the timeline
// (src/lib/whatsapp/render.ts, kept import-free for the browser).
export { renderBody } from "@/lib/whatsapp/render";

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
