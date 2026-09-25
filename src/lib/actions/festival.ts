"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createTranslator } from "next-intl";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { prefillFestivals } from "@/lib/festivals";
import { calendarDay } from "@/lib/follow-ups";
import { isoDate } from "@/lib/format";
import { loadMessages } from "@/lib/messages";
import { safeAction } from "@/lib/safe-action";
import { occasionLeadDays, SETTING, setSetting } from "@/lib/settings";
import {
  festivalIdInput,
  festivalInput,
  occasionSettingsInput,
  prefillFestivalsInput,
  updateFestivalInput,
} from "@/lib/validation/festival";

// Settings → Festivals and occasions (M23). Admin only: one calendar for the store.

const ADMIN = { roles: ["ADMIN" as const] };
const PAGE = "/settings/festivals";

async function device() {
  return (await headers()).get("user-agent");
}

async function branchIdOf(branch: string): Promise<string | null> {
  if (branch === "all") return null;
  const found = await db.branch.findFirst({
    where: { id: branch, status: "ACTIVE" },
    select: { id: true },
  });
  if (!found) throw new AppError("NOT_FOUND", { field: "branch" });
  return found.id;
}

export const addFestival = safeAction({
  name: "addFestival",
  schema: festivalInput,
  auth: ADMIN,
  handler: async (input, { user }) => {
    const branchId = await branchIdOf(input.branch);
    const userDevice = await device();
    const festival = await db.$transaction(async (tx) => {
      const row = await tx.festival.create({
        data: {
          name: input.name,
          date: calendarDay(input.date),
          branchId,
          confirmed: true, // typed in by the admin: they know the date
          createdById: user.id,
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        userId: user.id,
        branchId,
        action: AUDIT.festivalCreate,
        entityType: "Festival",
        entityId: row.id,
        newValue: { name: input.name, date: input.date, branchId, confirmed: true },
        device: userDevice,
      });
      return row;
    });
    revalidatePath(PAGE);
    return { id: festival.id };
  },
});

export const updateFestival = safeAction({
  name: "updateFestival",
  schema: updateFestivalInput,
  auth: ADMIN,
  handler: async (input, { user }) => {
    const before = await db.festival.findFirst({
      where: { id: input.id, active: true },
      select: { name: true, date: true, branchId: true, confirmed: true },
    });
    if (!before) throw new AppError("NOT_FOUND");
    const branchId = await branchIdOf(input.branch);
    const userDevice = await device();
    await db.$transaction(async (tx) => {
      await tx.festival.update({
        where: { id: input.id },
        data: {
          name: input.name,
          date: calendarDay(input.date),
          branchId,
          confirmed: input.confirmed,
        },
      });
      await writeAudit(tx, {
        userId: user.id,
        branchId,
        action: AUDIT.festivalUpdate,
        entityType: "Festival",
        entityId: input.id,
        oldValue: { ...before, date: isoDate(before.date) },
        newValue: { name: input.name, date: input.date, branchId, confirmed: input.confirmed },
        device: userDevice,
      });
    });
    revalidatePath(PAGE);
    return { saved: true };
  },
});

// Switched off, not deleted (CLAUDE.md): the audit log still refers to the day.
export const removeFestival = safeAction({
  name: "removeFestival",
  schema: festivalIdInput,
  auth: ADMIN,
  handler: async (input, { user }) => {
    const before = await db.festival.findFirst({
      where: { id: input.id, active: true },
      select: { name: true, date: true, branchId: true },
    });
    if (!before) throw new AppError("NOT_FOUND");
    const userDevice = await device();
    await db.$transaction(async (tx) => {
      await tx.festival.update({ where: { id: input.id }, data: { active: false } });
      await writeAudit(tx, {
        userId: user.id,
        branchId: before.branchId,
        action: AUDIT.festivalRemove,
        entityType: "Festival",
        entityId: input.id,
        oldValue: { name: before.name, date: isoDate(before.date), active: true },
        newValue: { active: false },
        device: userDevice,
      });
    });
    revalidatePath(PAGE);
    return { removed: true };
  },
});

// "Add common festivals": this year's and next year's, named in the admin's language,
// for all branches, unconfirmed until the admin checks each date. Ones already in the
// calendar (same name and day) are left alone, so pressing it twice adds nothing.
export const prefillCommonFestivals = safeAction({
  name: "prefillCommonFestivals",
  schema: prefillFestivalsInput,
  auth: ADMIN,
  handler: async (_input, { user }) => {
    const t = createTranslator({
      locale: user.language,
      messages: await loadMessages(user.language),
      namespace: "festivals",
    });
    const wanted = prefillFestivals(isoDate(new Date())).map((festival) => ({
      name: t(`names.${festival.key}` as Parameters<typeof t>[0]),
      date: festival.date,
    }));
    const existing = await db.festival.findMany({
      where: { active: true, branchId: null, name: { in: wanted.map((f) => f.name) } },
      select: { name: true, date: true },
    });
    const have = new Set(existing.map((row) => `${row.name}|${isoDate(row.date)}`));
    const missing = wanted.filter((festival) => !have.has(`${festival.name}|${festival.date}`));
    const userDevice = await device();
    // Up to ~50 festivals and their audit rows in two statements (ids made here, so the
    // audit rows can name them), not a hundred round trips inside one transaction.
    const rows = missing.map((festival) => ({
      id: randomUUID(),
      name: festival.name,
      date: calendarDay(festival.date),
      branchId: null,
      confirmed: false,
      createdById: user.id,
    }));
    await db.$transaction(async (tx) => {
      if (rows.length === 0) return;
      await tx.festival.createMany({ data: rows });
      await tx.auditLog.createMany({
        data: rows.map((row) => ({
          userId: user.id,
          action: AUDIT.festivalCreate,
          entityType: "Festival",
          entityId: row.id,
          newValue: {
            name: row.name,
            date: isoDate(row.date),
            branchId: null,
            confirmed: false,
            prefilled: true,
          },
          device: userDevice?.slice(0, 255) ?? null,
        })),
      });
    });
    revalidatePath(PAGE);
    return { added: rows.length };
  },
});

// The occasion lead days, read by the worker on every run.
export const updateOccasionSettings = safeAction({
  name: "updateOccasionSettings",
  schema: occasionSettingsInput,
  auth: ADMIN,
  handler: async (input, { user }) => {
    const before = { occasionLeadDays: await occasionLeadDays() };
    if (before.occasionLeadDays === input.occasionLeadDays) return { saved: true };
    const userDevice = await device();
    await db.$transaction(async (tx) => {
      await setSetting(tx, SETTING.occasionLeadDays, input.occasionLeadDays, user.id);
      await writeAudit(tx, {
        userId: user.id,
        action: AUDIT.settingUpdate,
        entityType: "Setting",
        entityId: SETTING.occasionLeadDays,
        oldValue: before,
        newValue: input,
        device: userDevice,
      });
    });
    revalidatePath(PAGE);
    return { saved: true };
  },
});
