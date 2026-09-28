import { getTranslations } from "next-intl/server";
import { AskSection } from "@/components/ai/ask-section";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai/suggest";

// M21: the Ask screen. Salespeople reach it from the menu (about their own customers);
// managers and admins have the same box at the top of the Store overview.
export default async function AskPage() {
  const user = await requireUser();
  const t = await getTranslations("ask");
  return (
    <AppShell role={user.role} title={t("title")}>
      {(await aiAvailable()) ? (
        <AskSection user={user} />
      ) : (
        <Card className="p-4 text-muted-foreground">{t("off")}</Card>
      )}
    </AppShell>
  );
}
