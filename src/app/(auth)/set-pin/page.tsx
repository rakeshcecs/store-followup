import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { PinForm } from "@/app/(auth)/set-pin/pin-form";
import { getUser, landingPath } from "@/lib/auth";
import { db } from "@/lib/db";

// Shown after a first login or a manager's reset. Signed in, but deliberately outside
// the app shells: there is nothing to navigate to until the PIN is set.
export default async function SetPinPage() {
  // getUser, not requireUser: this screen is reached with a cookie that may have gone
  // stale, and the honest answer to that is the login screen, not an error page.
  const user = await getUser();
  if (!user) redirect("/login");
  const t = await getTranslations("auth");

  const { mustChangePin } = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { mustChangePin: true },
  });

  // Someone who already chose their own PIN belongs on the profile screen, where
  // changing it asks for the old one first.
  if (!mustChangePin) redirect("/profile/pin");

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-6 px-6 pt-11 pb-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading-style text-3xl">{t("setPinTitle")}</h1>
        <p className="text-muted-foreground">{t("setPinText")}</p>
      </div>
      <PinForm askCurrentPin={false} nextHref={landingPath(user.role)} />
    </main>
  );
}
