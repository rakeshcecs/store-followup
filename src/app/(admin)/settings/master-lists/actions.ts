"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { RequireUserOptions, SessionUser } from "@/lib/auth";
import { AUDIT, writeAudit } from "@/lib/audit";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ALL_BRANCHES, assertBranchAccess } from "@/lib/permissions";
import { safeAction } from "@/lib/safe-action";
import {
  createItemInput,
  deleteItemInput,
  renameItemInput,
  reorderItemsInput,
  setItemActiveInput,
  type ListKind,
} from "@/lib/validation/master-list";

// Master lists are an admin's job (SOW M04, "Admin only").
const ADMIN_ONLY: RequireUserOptions = { roles: ["ADMIN"] };

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

// Everything below is written once and runs against both models. They differ in exactly
// two ways: reasons have no branchId, and they point at different relations when asked
// "is this still in use?".
const LISTS = {
  category: {
    audit: {
      create: AUDIT.categoryCreate,
      update: AUDIT.categoryUpdate,
      activate: AUDIT.categoryActivate,
      deactivate: AUDIT.categoryDeactivate,
      delete: AUDIT.categoryDelete,
    },
    entityType: "RequirementCategory",
    path: "/settings/categories",
    hasBranch: true,
  },
  reason: {
    audit: {
      create: AUDIT.reasonCreate,
      update: AUDIT.reasonUpdate,
      activate: AUDIT.reasonActivate,
      deactivate: AUDIT.reasonDeactivate,
      delete: AUDIT.reasonDelete,
    },
    entityType: "LostReason",
    path: "/settings/reasons",
    hasBranch: false,
  },
} as const;

// Both models carry the same columns, but Prisma generates a separate delegate type for
// each and a union of those cannot be called. The two functions below are the only place
// that is papered over: they narrow a delegate to exactly the calls this file makes, so
// every handler stays free of `if (kind === …)`. tests/db/master-list-actions.test.ts
// runs the real thing against both models, which is what keeps the shape honest.
type ListRow = {
  id: string;
  nameEn: string;
  nameHi: string;
  nameGu: string;
  sortOrder: number;
  active: boolean;
  branchId?: string | null;
};

type ListDelegate = {
  findMany(args: { where?: object; orderBy?: object; select?: object }): Promise<ListRow[]>;
  findFirst(args: { orderBy?: object; select?: object }): Promise<ListRow | null>;
  findUnique(args: { where: { id: string } }): Promise<ListRow | null>;
  create(args: { data: object }): Promise<ListRow>;
  update(args: { where: { id: string }; data: object }): Promise<ListRow>;
  delete(args: { where: { id: string } }): Promise<ListRow>;
};

function table(kind: ListKind): ListDelegate {
  return (kind === "category" ? db.requirementCategory : db.lostReason) as unknown as ListDelegate;
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
function txTable(tx: Tx, kind: ListKind): ListDelegate {
  return (kind === "category" ? tx.requirementCategory : tx.lostReason) as unknown as ListDelegate;
}

// How many records already point at this item. Deleting one of those would take the
// history with it, which is why only unused items may go.
//
// branch-scope-exempt: a lost reason is one list for the whole store, so "is it in use"
// has to count visits in every branch; only a number comes back, never a row.
async function usageCount(kind: ListKind, id: string): Promise<number> {
  if (kind === "category") {
    const [enquiries, visits] = await Promise.all([
      db.enquiryCategory.count({ where: { categoryId: id } }),
      db.visitCategory.count({ where: { categoryId: id } }),
    ]);
    return enquiries + visits;
  }
  const [enquiries, visits] = await Promise.all([
    db.enquiry.count({ where: { lostReasonId: id } }),
    db.visit.count({ where: { lostReasonId: id } }),
  ]);
  return enquiries + visits;
}

// Unique within its list. No database index can do this: a category's branchId is
// nullable and MySQL allows many NULLs in a unique index, so the store-wide items — the
// ones most likely to be duplicated — would not be covered.
async function assertNameFree(
  kind: ListKind,
  nameEn: string,
  branchId: string | null,
  exceptId?: string,
): Promise<void> {
  const rows = await table(kind).findMany({
    where: { nameEn },
    select: { id: true, nameEn: true, ...(LISTS[kind].hasBranch ? { branchId: true } : {}) },
  });

  const clash = rows.find((row) => {
    if (row.id === exceptId) return false;
    if (!LISTS[kind].hasBranch) return true;
    const rowBranch = (row as { branchId: string | null }).branchId;
    // A store-wide item collides with every branch, and a branch item collides with the
    // store-wide one: both would show up together in the same chip row.
    return rowBranch === null || branchId === null || rowBranch === branchId;
  });

  if (clash) {
    throw new AppError("CONFLICT", {
      message: "masterLists.errors.nameTaken",
      field: "nameEn",
      values: { name: clash.nameEn },
    });
  }
}

// "all" from the form means null in the database. A branch id is checked against what
// this admin may reach, so a posted id from another store's branch cannot land here.
function branchIdFor(kind: ListKind, choice: string, user: SessionUser): string | null {
  if (!LISTS[kind].hasBranch || choice === ALL_BRANCHES) return null;
  assertBranchAccess(user, choice);
  return choice;
}

// A new item goes to the end of the list the admin is looking at.
async function nextSortOrder(kind: ListKind): Promise<number> {
  const last = await table(kind).findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? 0) + 1;
}

// Out of the admin's current branch scope is the same answer as not existing.
async function loadInScope(kind: ListKind, id: string, user: SessionUser) {
  const item = await table(kind).findUnique({ where: { id } });
  if (!item) throw new AppError("NOT_FOUND");

  if (LISTS[kind].hasBranch) {
    const scope = await getBranchScope(user);
    const branchId = (item as { branchId: string | null }).branchId;
    const reachable = scope.all || branchId === null || scope.branchIds.includes(branchId ?? "");
    if (!reachable) throw new AppError("NOT_FOUND");
  }
  return item;
}

export const createItem = safeAction({
  name: "createItem",
  schema: createItemInput,
  auth: ADMIN_ONLY,
  handler: async ({ kind, branchId, ...names }, { user }) => {
    const branch = branchIdFor(kind, branchId, user);
    await assertNameFree(kind, names.nameEn, branch);

    const created = await db.$transaction(async (tx) => {
      const item = await txTable(tx, kind).create({
        data: {
          ...names,
          sortOrder: await nextSortOrder(kind),
          ...(LISTS[kind].hasBranch ? { branchId: branch } : {}),
        },
      });

      await writeAudit(tx, {
        userId: user.id,
        branchId: branch,
        action: LISTS[kind].audit.create,
        entityType: LISTS[kind].entityType,
        entityId: item.id,
        newValue: names,
        device: await device(),
      });
      return item;
    });

    revalidatePath(LISTS[kind].path);
    return { id: created.id };
  },
});

export const renameItem = safeAction({
  name: "renameItem",
  schema: renameItemInput,
  auth: ADMIN_ONLY,
  handler: async ({ kind, id, branchId, ...names }, { user }) => {
    const before = await loadInScope(kind, id, user);
    const branch = branchIdFor(kind, branchId, user);
    await assertNameFree(kind, names.nameEn, branch, id);

    await db.$transaction(async (tx) => {
      await txTable(tx, kind).update({
        where: { id },
        data: { ...names, ...(LISTS[kind].hasBranch ? { branchId: branch } : {}) },
      });
      await writeAudit(tx, {
        userId: user.id,
        branchId: branch,
        action: LISTS[kind].audit.update,
        entityType: LISTS[kind].entityType,
        entityId: id,
        oldValue: { nameEn: before.nameEn, nameHi: before.nameHi, nameGu: before.nameGu },
        newValue: names,
        device: await device(),
      });
    });

    revalidatePath(LISTS[kind].path);
    return { id };
  },
});

export const setItemActive = safeAction({
  name: "setItemActive",
  schema: setItemActiveInput,
  auth: ADMIN_ONLY,
  handler: async ({ kind, id, active }, { user }) => {
    const before = await loadInScope(kind, id, user);
    if (before.active === active) return { id, active };

    await db.$transaction(async (tx) => {
      await txTable(tx, kind).update({ where: { id }, data: { active } });
      await writeAudit(tx, {
        userId: user.id,
        action: active ? LISTS[kind].audit.activate : LISTS[kind].audit.deactivate,
        entityType: LISTS[kind].entityType,
        entityId: id,
        oldValue: { active: before.active },
        newValue: { active },
        device: await device(),
      });
    });

    revalidatePath(LISTS[kind].path);
    return { id, active };
  },
});

export const reorderItems = safeAction({
  name: "reorderItems",
  schema: reorderItemsInput,
  auth: ADMIN_ONLY,
  handler: async ({ kind, ids }, { user }) => {
    // Every id is checked against the scope before anything is written: a posted list
    // must not be able to renumber rows the admin cannot even see.
    for (const id of ids) await loadInScope(kind, id, user);

    await db.$transaction(ids.map((id, index) => txTableStatement(kind, id, index + 1)));

    revalidatePath(LISTS[kind].path);
    return { count: ids.length };
  },
});

// Built outside the transaction callback so the whole reorder is one round trip.
function txTableStatement(kind: ListKind, id: string, sortOrder: number) {
  return kind === "category"
    ? db.requirementCategory.update({ where: { id }, data: { sortOrder } })
    : db.lostReason.update({ where: { id }, data: { sortOrder } });
}

export const deleteItem = safeAction({
  name: "deleteItem",
  schema: deleteItemInput,
  auth: ADMIN_ONLY,
  handler: async ({ kind, id }, { user }) => {
    const item = await loadInScope(kind, id, user);

    // The one place in the app that really deletes a row. The module prompt allows it for
    // an unused master-list item — a typo nobody ever picked — and nothing else. Anything
    // a record points at is deactivated instead, so history stays readable.
    const used = await usageCount(kind, id);
    if (used > 0) {
      throw new AppError("RULE", {
        message: "masterLists.errors.inUse",
        values: { count: used },
      });
    }

    await db.$transaction(async (tx) => {
      await txTable(tx, kind).delete({ where: { id } });
      await writeAudit(tx, {
        userId: user.id,
        action: LISTS[kind].audit.delete,
        entityType: LISTS[kind].entityType,
        entityId: id,
        // The whole row: after this the item exists nowhere else.
        oldValue: item,
        device: await device(),
      });
    });

    revalidatePath(LISTS[kind].path);
    return { id };
  },
});
