// A query string can repeat a key (`?q=a&q=b`), and Next then hands the page an array
// where its type says string — `.trim()` on it, or an array as a Prisma id, was a 500.
export type SearchValue = string | string[] | undefined;

export function firstParam(value: SearchValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first || undefined;
}
