import { getTranslations } from "next-intl/server";
import { PinForm } from "@/app/(auth)/set-pin/pin-form";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";

// Changing your own PIN later: unlike /set-pin this asks for the current one first,
// because here nobody has forced the change.
export default async function ChangePinPage() {
  const user = await requireUser();
  const t = await getTranslations("auth");

  return (
    <AppShell
      role={user.role}
      title={t("changePinTitle")}
      backHref="/profile"
      backLabel={t("back")}
    >
      <PinForm askCurrentPin nextHref="/profile" />
    </AppShell>
  );
}
