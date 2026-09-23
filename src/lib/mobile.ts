// Indian mobile numbers are stored as exactly 10 digits starting 6-9 (CLAUDE.md), so
// every number entering the app goes through here first: login, customers (M05), the
// importer (M09) and WhatsApp (M21) all receive them typed in different shapes.

// Accepts "+91 98765 43210", "098765-43210", "9876543210" and returns "9876543210".
// Anything else (a short number, a 5-series number, most landlines) returns null.
//
// One case cannot be decided here: "079 1234 5678" is an Ahmedabad landline, but it is
// also eleven digits starting with 0, exactly like a mobile written "09876543210", and
// after the 0 it reads 7912345678, which is a valid mobile. Nothing in the digits tells
// the two apart, so it is accepted — every screen that uses this asks for a mobile.
export function normalizeMobile(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
