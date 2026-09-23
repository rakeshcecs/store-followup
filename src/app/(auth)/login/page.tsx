import { ShoppingBag } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { LanguageSwitcher } from "@/components/language/language-switcher";
import { InstallHelp } from "@/components/pwa/install-help";
import { getUser, landingPath } from "@/lib/auth";

// The only screen anyone can reach without a session. Layout follows the prototype
// (docs/store-followup-prototype.html:247-255): brand block, install card, two fields,
// one primary button, then the line about who resets a PIN.
export default async function LoginPage() {
  // Already signed in: nothing here to do. src/proxy.ts cannot make this call, because a
  // cookie alone does not say whether the session is still alive.
  const user = await getUser();
  if (user) redirect(landingPath(user.role));

  const t = await getTranslations("auth");
  const tApp = await getTranslations("app");

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-7 px-6 pt-11 pb-6">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-2.5">
          <span className="flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShoppingBag aria-hidden className="size-7" />
          </span>
          <span className="text-sm font-bold text-muted-foreground">{tApp("storeName")}</span>
          <h1 className="font-heading-style text-[34px] leading-tight">{t("title")}</h1>
        </div>
        {/* Before any session exists: the choice lives in a cookie, and the login
            action copies it onto the user row (M18.02). */}
        <LanguageSwitcher />
      </div>

      <p className="text-base leading-relaxed text-muted-foreground">{t("tagline")}</p>

      <InstallHelp />

      <LoginForm />

      <p className="text-center text-sm text-muted-foreground">{t("forgotPin")}</p>
    </main>
  );
}
