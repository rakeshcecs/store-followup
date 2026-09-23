// What every screen outside Settings reads: the active items, in the admin's order, in
// the reader's language. M07's chips, M12's grouping and M13/M14's exports all come
// through here, which is what makes "a new category appears without a code change" true
// (SOW M04 "Done when").
import type { Locale } from "@/i18n/config";
import { db } from "@/lib/db";
import { withLocalizedName, type LocalizedNameRow } from "@/lib/localized-name";
import { branchWhereShared, type BranchScope } from "@/lib/permissions";

export type MasterListItem = LocalizedNameRow & {
  id: string;
  sortOrder: number;
  name: string;
};

const SELECT = {
  id: true,
  nameEn: true,
  nameHi: true,
  nameGu: true,
  sortOrder: true,
} as const;

// Deactivated items stay on old records and in reports (SOW M04.03); they simply stop
// being offered, which is exactly what `active: true` here means.
export async function activeCategories(
  scope: BranchScope,
  locale: Locale,
): Promise<MasterListItem[]> {
  const rows = await db.requirementCategory.findMany({
    // branchWhereShared, not branchWhere: a null branchId means every branch (SOW M17.07).
    where: { active: true, ...branchWhereShared(scope) },
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    select: SELECT,
  });
  return rows.map((row) => withLocalizedName(row, locale));
}

// Reasons have no branch column in the schema, so they are always store-wide.
export async function activeLostReasons(locale: Locale): Promise<MasterListItem[]> {
  const rows = await db.lostReason.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    select: SELECT,
  });
  return rows.map((row) => withLocalizedName(row, locale));
}
