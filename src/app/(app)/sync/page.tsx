import { getTranslations } from "next-intl/server";
import { SyncCenter } from "@/components/offline/sync-center";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";

// M19: what this phone saved offline — "Needs your attention" and "Waiting to sync".
// Everything on it is read from the phone itself; the server only renders the frame.
export default async function SyncPage() {
  const user = await requireUser();
  const t = await getTranslations("sync.center");
  return (
    <AppShell role={user.role} title={t("title")}>
      <SyncCenter />
    </AppShell>
  );
}
