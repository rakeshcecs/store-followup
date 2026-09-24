// Dates, numbers and money in the reading language (M18.04). The ONLY place in the app
// allowed to touch Intl — tests/unit/no-intl-outside-format.test.ts enforces that, so
// a bare "en" can never leak into a NumberFormat and print 100,000 instead of 1,00,000.
//
// Deliberately free of next-intl: these run in worker jobs and in report and export
// code (M13/M14) where there is no request and no provider.
import { intlLocales, timeZone, type Locale } from "@/i18n/config";

// Building an Intl formatter is expensive and a report formats thousands of rows
// (reports must stay under 5 s), so keep one instance per locale and shape.
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const collators = new Map<Locale, Intl.Collator>();

export function intlLocale(locale: Locale): string {
  return intlLocales[locale];
}

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone });
    dateFormats.set(key, format);
  }
  return format;
}

function numberFormat(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale(locale), options);
    numberFormats.set(key, format);
  }
  return format;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

// CLDR shortens September to "Sept" for en-IN, but the spec says "21 Sep 2026".
// Trim it back for English only; Hindi and Gujarati keep their own abbreviations.
function shortenEnglishMonth(parts: Intl.DateTimeFormatPart[], locale: Locale): string {
  return parts
    .map((part) => (locale === "en" && part.type === "month" ? part.value.slice(0, 3) : part.value))
    .join("");
}

// "21 Sep 2026"
export function formatDate(value: Date | string, locale: Locale): string {
  const parts = dateFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(toDate(value));
  return shortenEnglishMonth(parts, locale);
}

// "Mon, 21 Sep"
export function formatDayDate(value: Date | string, locale: Locale): string {
  const parts = dateFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(toDate(value));
  return shortenEnglishMonth(parts, locale);
}

// "9:30 am"
export function formatTime(value: Date | string, locale: Locale): string {
  return dateFormat(locale, { hour: "numeric", minute: "2-digit" }).format(toDate(value));
}

// "21 Sep 2026, 9:30 am"
export function formatDateTime(value: Date | string, locale: Locale): string {
  return `${formatDate(value, locale)}, ${formatTime(value, locale)}`;
}

// "Sep 2026" — report headings.
export function formatMonthYear(value: Date | string, locale: Locale): string {
  const parts = dateFormat(locale, { month: "short", year: "numeric" }).formatToParts(
    toDate(value),
  );
  return shortenEnglishMonth(parts, locale);
}

// "2026-09-21" for the IST day. For <input type="date">, query strings and export
// keys — never for display.
export function isoDate(value: Date | string): string {
  const parts = dateFormat("en", { year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(toDate(value))
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

// 0–23, the hour in the shop (IST): "Good morning" turns into "Good afternoon" at 12.
export function istHour(value: Date | string): number {
  const hour = dateFormat("en", { hour: "numeric", hourCycle: "h23" })
    .formatToParts(toDate(value))
    .find((part) => part.type === "hour")?.value;
  return Number(hour) % 24;
}

// "1,00,000" — Indian grouping comes from the -IN region, not from an option.
export function formatNumber(value: number, locale: Locale): string {
  return numberFormat(locale, {}).format(value);
}

// "₹1,25,000". Accepts a Prisma Decimal (Sale.billAmount) as well as a number.
export function formatMoney(
  value: number | string | { toString(): string },
  locale: Locale,
  options: { decimals?: 0 | 2 } = {},
): string {
  const decimals = options.decimals ?? 0;
  const amount = typeof value === "number" ? value : Number(value.toString());
  return numberFormat(locale, {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

// "98765 43210". The same in every language, so no locale argument.
export function formatMobile(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : value;
}

// Alphabetical order in the reading language, for sorting names on screen.
export function collator(locale: Locale): Intl.Collator {
  let instance = collators.get(locale);
  if (!instance) {
    instance = new Intl.Collator(intlLocale(locale));
    collators.set(locale, instance);
  }
  return instance;
}
