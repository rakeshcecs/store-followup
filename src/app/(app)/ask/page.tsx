import { getTranslations } from "next-intl/server";
import { AskSection } from "@/components/ai/ask-section";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai/suggest";

// M21: the Ask screen, scoped to what the person may see (a salesperson: their own
// customers). Not in any menu and not on the Store overview; reached by its address only.
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
