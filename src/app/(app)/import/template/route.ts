import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import { getUser } from "@/lib/auth";
import { templateXlsx } from "@/lib/import/files";

export const runtime = "nodejs";

// M24.01: the Excel template, headings in the reader's language.
export async function GET() {
  const user = await getUser();
  if (!user) return new Response(null, { status: 401 });
  if (user.role === "SALESPERSON") return new Response(null, { status: 404 });
  const locale = (await getLocale()) as Locale;
  const tApp = await getTranslations("app");
  const body = await templateXlsx(locale, tApp("storeName"));
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="customer-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
