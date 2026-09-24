import { getTranslations } from "next-intl/server";
import { ReminderForm } from "@/app/(admin)/settings/reminders/reminder-form";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { reminderTimes } from "@/lib/settings";

// Settings → Reminders (M14). Admin only; one set of times for every branch.
export default async function ReminderSettingsPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const t = await getTranslations("reminderSettings");
  const tSettings = await getTranslations("settings");

  return (
    <AppShell
      role={user.role}
      title={t("title")}
      backHref="/settings"
      backLabel={tSettings("title")}
    >
      <ReminderForm times={await reminderTimes()} />
    </AppShell>
  );
}
