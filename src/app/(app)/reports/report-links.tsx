import { BarChart3, ChevronRight, FileUp, History } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

// Also the "Reports" list on the Store overview (M12.05). `audit`: the audit log (M16)
// and the customer import (M24) at the end, for managers and admins — the phone's nav
// has no room for a fifth item.
export async function ReportLinks({ codes, audit = false }: { codes: string[]; audit?: boolean }) {
  const t = await getTranslations("reports");
  const tAudit = await getTranslations("audit");
  const tImport = await getTranslations("import");
  const tools = [
    { href: "/audit", icon: History, title: tAudit("title"), about: tAudit("about") },
    { href: "/import", icon: FileUp, title: tImport("title"), about: tImport("about") },
  ];
  return (
    <ul className="flex flex-col gap-2.5">
      {codes.map((code) => (
        <li key={code}>
          <Link
            href={`/reports/${code}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 no-underline hover:bg-black/2"
          >
            <BarChart3 aria-hidden className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 grow">
              <span className="block font-bold">{t(`names.${code}` as `names.${"r1"}`)}</span>
              <span className="block text-sm text-muted-foreground">
                {t(`about.${code}` as `about.${"r1"}`)}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
      {audit &&
        tools.map((tool) => (
          <li key={tool.href}>
            <Link
              href={tool.href}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 no-underline hover:bg-black/2"
            >
              <tool.icon aria-hidden className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 grow">
                <span className="block font-bold">{tool.title}</span>
                <span className="block text-sm text-muted-foreground">{tool.about}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
    </ul>
  );
}
