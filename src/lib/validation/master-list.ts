import { z } from "zod";
import { ALL_BRANCHES } from "@/lib/permissions";
import { id, requiredText } from "@/lib/validation/common";

// Which of the two lists an action is working on. One set of actions serves both,
// because everything except the branch column is identical.
export const listKinds = ["category", "reason"] as const;
export type ListKind = (typeof listKinds)[number];

// Names are required in all three languages (SOW M18.03), and capped at 50 — the module
// prompt's number. The columns hold 100, so nothing had to change in the schema.
const NAME_MAX = 50;
const name = (language: "En" | "Hi" | "Gu") =>
  requiredText(
    1,
    NAME_MAX,
    `masterLists.errors.name${language}Required`,
    "masterLists.errors.nameTooLong",
  );

// "all" (not an empty string) means every branch, matching the branch switcher's own
// value. Reasons have no branch column, so they ignore it.
const branchChoice = z.union([z.literal(ALL_BRANCHES), id]).default(ALL_BRANCHES);

export const masterListItemInput = z.object({
  kind: z.enum(listKinds),
  nameEn: name("En"),
  nameHi: name("Hi"),
  nameGu: name("Gu"),
  branchId: branchChoice,
});

export const createItemInput = masterListItemInput;
export const renameItemInput = masterListItemInput.extend({ id });

export const setItemActiveInput = z.object({
  kind: z.enum(listKinds),
  id,
  active: z.boolean(),
});

export const deleteItemInput = z.object({ kind: z.enum(listKinds), id });

// The whole list in its new order, not one moved row: the server then owns sortOrder
// 1..n and two people dragging at once cannot interleave into a half-order.
export const reorderItemsInput = z.object({
  kind: z.enum(listKinds),
  ids: z.array(id).min(1),
});

export type MasterListItemInput = z.infer<typeof masterListItemInput>;
