"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { TextInput } from "@/components/ui/text-input";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import { login } from "@/lib/actions/auth";
import { loginInput } from "@/lib/validation/auth";

export function LoginForm() {
  const t = useTranslations("auth");
  const tError = useErrorMessage();
  const locale = useLocale();
  const router = useRouter();
  const nextPath = useSearchParams().get("next");

  const { formAction, pending, errors, formError } = useActionForm(
    login,
    loginInput,
    ({ mustChangePin }) => {
      // A first login, or a manager's reset: choose a PIN before anything else.
      if (mustChangePin) {
        router.replace("/set-pin");
        return;
      }
      // "/" sends each role to its own screen, so this needs no role table of its own.
      router.replace(nextPath ?? "/");
    },
  );

  const errorFor = (field: string) => (errors[field] ? tError(errors[field]) : undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {/* Whatever they picked with the switcher above is saved onto their account. */}
      <input type="hidden" name="language" value={locale} />

      <TextInput
        name="mobile"
        label={t("fields.mobile")}
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        error={errorFor("mobile")}
      />
      <TextInput
        name="pin"
        label={t("fields.pin")}
        type="password"
        inputMode="numeric"
        maxLength={4}
        autoComplete="current-password"
        error={errorFor("pin")}
      />

      <FieldError>{formError ? tError(formError) : undefined}</FieldError>

      <Button type="submit" disabled={pending}>
        {t("logIn")}
      </Button>
    </form>
  );
}
