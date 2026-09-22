import { getTranslations } from "next-intl/server";
import { InstallHelp } from "@/components/pwa/install-help";

// Temporary placeholder to check design tokens, fonts and languages. Replaced by real screens later.
export default async function Home() {
  const t = await getTranslations("home");

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-4 p-4">
      <h1 className="font-heading-style text-3xl">{t("title")}</h1>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-muted-foreground">{t("setupCheck")}</p>
      </div>
      <InstallHelp />
      <div className="flex gap-2">
        <span className="h-10 w-10 rounded-lg bg-primary" />
        <span className="h-10 w-10 rounded-lg bg-success" />
        <span className="h-10 w-10 rounded-lg bg-warning" />
        <span className="h-10 w-10 rounded-lg bg-danger" />
      </div>
    </main>
  );
}
