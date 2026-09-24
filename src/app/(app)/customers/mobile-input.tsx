"use client";

import { useState } from "react";
import { Field, fieldControlClass } from "@/components/ui/field";
import { mobileDigits } from "@/lib/mobile";
import { cn } from "@/lib/utils";

type MobileInputProps = {
  label: string;
  hint?: string;
  error?: string;
  name?: string;
  defaultValue?: string;
  autoFocus?: boolean;
};

// Shown in its own box in front of the number (M05.01). Not a message key: it is the
// same three characters in every language, and every number the app stores is Indian.
const COUNTRY_CODE = "+91";

// M05.02: "spaces and dashes are removed automatically". Doing it as the person types
// rather than on submit means the box always shows exactly what will be saved. No
// maxLength: the browser cuts a pasted "98765 43210" to its first 10 characters before
// the spaces are removed, which lost the last digit; mobileDigits() caps it instead.
export function MobileInput({
  label,
  hint,
  error,
  name = "mobile",
  defaultValue = "",
  autoFocus,
}: MobileInputProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <div className="flex gap-2">
          <span
            aria-hidden
            className="flex h-13 w-16 shrink-0 items-center justify-center rounded-md border-[1.5px] border-input bg-card text-[17px] text-muted-foreground"
          >
            {COUNTRY_CODE}
          </span>
          <input
            data-slot="text-input"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={autoFocus}
            name={name}
            value={value}
            onChange={(event) => setValue(mobileDigits(event.target.value))}
            className={cn(fieldControlClass, "h-13 rounded-md px-3.5 text-[17px]")}
            {...control}
          />
        </div>
      )}
    </Field>
  );
}
