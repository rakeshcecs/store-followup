import { getTranslations } from "next-intl/server";
import { AiSettingsForm } from "@/app/(admin)/settings/ai/ai-settings-form";
import { AppShell } from "@/components/layout/app-shell";
import { aiConfigured } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { aiDailyLimit, aiEnabled } from "@/lib/settings";

// Settings → AI assistant (M20.08). Admin only: the switch and the daily limit per person.
export default async function AiSettingsPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const t = await getTranslations("aiSettings");
  const tSettings = await getTranslations("settings");
  const [enabled, dailyLimit] = await Promise.all([aiEnabled(), aiDailyLimit()]);

  return (
    <AppShell
      role={user.role}
      title={t("title")}
      backHref="/settings"
      backLabel={tSettings("title")}
    >
      <AiSettingsForm enabled={enabled} dailyLimit={dailyLimit} configured={aiConfigured()} />
    </AppShell>
  );
}
