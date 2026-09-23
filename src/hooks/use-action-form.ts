"use client";

import { useState, useTransition } from "react";
import type { z } from "zod";
import type { ActionResult, MessageValues } from "@/lib/errors";

type SafeActionFn<T> = (input: unknown) => Promise<ActionResult<T>>;

type UseActionForm = {
  formAction: (formData: FormData) => void;
  pending: boolean;
  errors: Record<string, string>; // field name -> message key
  formError: string | null; // message key for errors that belong to no field
  // Placeholder values for whichever of the two carries them, e.g. { name: "Asha" }.
  errorValues: MessageValues | undefined;
};

// Bridges a plain <form> to a safeAction().
//
// The same zod schema runs here first so the person sees every wrong field at once:
// safeAction only reports the first problem, which on a six-field form would mean
// fixing them one at a time. The server parse stays the authority.
export function useActionForm<T>(
  action: SafeActionFn<T>,
  schema: z.ZodType,
  onSuccess?: (data: T) => void,
): UseActionForm {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [errorValues, setErrorValues] = useState<MessageValues | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  function formAction(formData: FormData) {
    const parsed = schema.safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        if (field && !(field in fieldErrors)) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      setFormError(Object.keys(fieldErrors).length > 0 ? null : "errors.validation");
      setErrorValues(undefined); // a zod message never has placeholders
      return;
    }

    setErrors({});
    setFormError(null);
    setErrorValues(undefined);

    startTransition(async () => {
      const result = await action(parsed.data);
      if (result.ok) {
        onSuccess?.(result.data);
        return;
      }
      setErrorValues(result.values);
      if (result.field) setErrors({ [result.field]: result.message });
      else setFormError(result.message);
    });
  }

  return { formAction, pending, errors, formError, errorValues };
}
