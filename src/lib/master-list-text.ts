// Master list names that were saved as text, shown in the reader's language (M18.03).
//
// Two records keep an English name as plain text rather than an id: an enquiry's title,
// made from its first two requirement categories ("Sherwani, Wedding Clothes", SOW 5.4),
// and the not-interested reason on a history row. The stored English stays the record;
// on screen and in exports each part that is a category's or a reason's English name is
// swapped for that item's name in the reader's language. Anything else — an imported
// title, a remark — is shown as it was typed.
import { cache } from "react";
import type { Locale } from "@/i18n/config";
import { db } from "@/lib/db";
import { localizedName } from "@/lib/localized-name";

const key = (text: string) => text.trim().toLowerCase();

export type NameTranslator = (english: string) => string;

// One read of both lists per request (a list of cards asks once per card); English needs none.
export const masterListTranslator = cache(async (locale: Locale): Promise<NameTranslator> => {
  if (locale === "en") return (english) => english;
  const select = { nameEn: true, nameHi: true, nameGu: true } as const;
  const [categories, reasons] = await Promise.all([
    db.requirementCategory.findMany({ select }),
    db.lostReason.findMany({ select }),
  ]);
  const names = new Map<string, string>();
  for (const row of [...categories, ...reasons])
    names.set(key(row.nameEn), localizedName(row, locale));
  return (english) => names.get(key(english)) ?? english;
});

// "Sherwani, Wedding Clothes" → "शेरवानी, शादी के कपड़े".
export function translateTitle(name: NameTranslator, title: string): string {
  return title
    .split(", ")
    .map((part) => name(part))
    .join(", ");
}

export async function enquiryTitleTranslator(
  locale: Locale,
): Promise<<T extends string | null | undefined>(title: T) => T> {
  const name = await masterListTranslator(locale);
  return ((title: string | null | undefined) => (title ? translateTitle(name, title) : title)) as <
    T extends string | null | undefined,
  >(
    title: T,
  ) => T;
}
