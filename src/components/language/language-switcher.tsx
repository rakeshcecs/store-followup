"use client";

import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { useErrorMessage } from "@/hooks/use-error-message";
import { languageNames, locales, type Locale } from "@/i18n/config";
import { setLanguage } from "@/lib/actions/language";

// One client component, no server half: the list is a three-item constant that is never
// empty, and the current value is already in the provider. That also means the M02 login
// screen, which has no session at all, can drop this in with no props.
const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-[15px] outline-none select-none data-highlighted:bg-primary-light";

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("language");
  const tError = useErrorMessage(); // action errors arrive as full message keys
  const [pending, startTransition] = useTransition();

  function choose(value: string) {
    if (value === locale) return;
    startTransition(async () => {
      const result = await setLanguage({ language: value as Locale });
      // No success toast: the whole screen changes language, which is the confirmation.
      if (!result.ok) toast.error(tError(result.message));
    });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t("switch")}
        disabled={pending}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-black/5 disabled:opacity-60"
      >
        <Languages aria-hidden className="size-6" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 rounded-xl border border-border bg-card p-1.5 shadow-[0_12px_24px_-10px_rgba(0,0,0,0.3)]"
        >
          <DropdownMenu.RadioGroup value={locale} onValueChange={choose}>
            {locales.map((code) => (
              <DropdownMenu.RadioItem key={code} value={code} className={itemClass}>
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden className="size-4 text-primary" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {languageNames[code]}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
