// Master list names in the reading language (M18.03), used by categories and
// not-interested reasons, and by anything later with the same three columns.
import type { Locale } from "@/i18n/config";
import { collator } from "@/lib/format";

// Structural, not `RequirementCategory | LostReason`: the same helper has to accept a
// Prisma `select` projection, which is assignable to neither model type. All three
// columns are required in the schema, so forgetting to select one is a type error
// rather than a silent English fallback.
export type LocalizedNameRow = { nameEn: string; nameHi: string; nameGu: string };

const FIELD = {
  en: "nameEn",
  hi: "nameHi",
  gu: "nameGu",
} as const satisfies Record<Locale, keyof LocalizedNameRow>;

// Falls back to English when the translation is blank.
export function localizedName(row: LocalizedNameRow, locale: Locale): string {
  const value = row[FIELD[locale]];
  return value.trim() ? value : row.nameEn;
}

// What a screen renders: the row plus one `name` the component can use without
// knowing anything about languages.
export function withLocalizedName<T extends LocalizedNameRow>(
  row: T,
  locale: Locale,
): T & { name: string } {
  return { ...row, name: localizedName(row, locale) };
}

// The admin's chosen order first, then alphabetically in the reading language.
export function sortByLocalizedName<T extends LocalizedNameRow & { sortOrder?: number }>(
  rows: T[],
  locale: Locale,
): (T & { name: string })[] {
  const compare = collator(locale);
  return rows
    .map((row) => withLocalizedName(row, locale))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || compare.compare(a.name, b.name));
}
