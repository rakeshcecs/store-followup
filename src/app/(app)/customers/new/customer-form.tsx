"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MobileInput } from "@/app/(app)/customers/mobile-input";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { FieldError } from "@/components/ui/field-error";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import { createCustomer } from "@/lib/actions/customer";
import { createCustomerInput } from "@/lib/validation/customer";

const FIND_PATH = "/customers";
const MOBILE_TAKEN = "customers.errors.mobileTaken";

// The fields this form actually draws a box for. An action may refuse on a field that is
// not one of them — `branchId` when an admin is looking at every branch at once — and
// without this the message had nowhere to go and the screen just sat there.
const OWN_FIELDS = new Set([
  "name",
  "mobile",
  "departmentId",
  "assignedToId",
  "area",
  "city",
  "occasion",
  "occasionDate",
  "altMobile",
  "address",
]);

type CustomerFormProps = {
  mobile: string; // carried from the search that found nothing (M05.05)
  departments: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  currentUserId: string;
  defaultCity: string; // the branch's own city (M05.06)
};

export function CustomerForm({
  mobile,
  departments,
  staff,
  currentUserId,
  defaultCity,
}: CustomerFormProps) {
  const t = useTranslations("customers");
  const tError = useErrorMessage();
  const router = useRouter();
  const [departmentId, setDepartmentId] = useState("");
  const [showMore, setShowMore] = useState(false);

  const { onSubmit, pending, errors, formError, errorValues } = useActionForm(
    createCustomer,
    createCustomerInput,
    (data: { id: string }) => {
      toast(t("saved"));
      // Straight into Record visit (M05.10). M07 fills that screen in.
      router.push(`/visits/new?customerId=${data.id}`);
    },
  );

  // M05.09: someone already has this number. The screen does not argue about it — it
  // goes to the search result for that number, which is that customer's card.
  const taken = errors["mobile"] === MOBILE_TAKEN;
  useEffect(() => {
    if (taken) router.push(`${FIND_PATH}?mobile=${mobile}`);
  }, [taken, router, mobile]);

  const errorFor = (field: string) =>
    errors[field] ? tError(errors[field], errorValues) : undefined;

  // An error about a field with no box of its own still has to be read somewhere.
  const strayError = Object.entries(errors).find(([field]) => !OWN_FIELDS.has(field))?.[1];
  const bottomError = formError ?? strayError;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4.5" noValidate>
      <TextInput
        name="name"
        label={t("fields.name")}
        autoComplete="off"
        autoFocus
        error={errorFor("name")}
      />

      <MobileInput label={t("fields.mobile")} defaultValue={mobile} error={errorFor("mobile")} />

      {departments.length > 0 && (
        <div>
          <span className="mb-2 block text-sm font-bold text-ink-2">{t("fields.department")}</span>
          <ChoiceChips
            type="single"
            label={t("fields.department")}
            value={departmentId}
            onValueChange={setDepartmentId}
            options={departments.map((department) => ({
              value: department.id,
              label: department.name,
            }))}
          />
          <input type="hidden" name="departmentId" value={departmentId} />
        </div>
      )}

      {/* Default to whoever is filling the form in (M05.07) — unless they do not work in
          the branch on screen, which an admin looking at another branch does not. */}
      <Select
        name="assignedToId"
        label={t("fields.assignedTo")}
        defaultValue={
          staff.some((person) => person.id === currentUserId) ? currentUserId : (staff[0]?.id ?? "")
        }
        options={staff.map((person) => ({ value: person.id, label: person.name }))}
        error={errorFor("assignedToId")}
      />

      <Button type="button" variant="secondary" onClick={() => setShowMore(!showMore)}>
        {showMore ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        {showMore ? t("hideDetails") : t("moreDetails")}
      </Button>

      {/* Kept mounted so anything already typed survives a collapse, and so the fields
          still post if the person hides them again. The `hidden` attribute rather than a
          class: it also takes the fields out of the tab order and out of a screen
          reader, which a display:none utility on its own would not guarantee. */}
      <div hidden={!showMore}>
        <div className="flex flex-col gap-4.5">
          <div className="grid gap-4.5 sm:grid-cols-2">
            <TextInput name="area" label={t("fields.area")} error={errorFor("area")} />
            <TextInput
              name="city"
              label={t("fields.city")}
              defaultValue={defaultCity}
              error={errorFor("city")}
            />
          </div>
          <TextInput name="occasion" label={t("fields.occasion")} error={errorFor("occasion")} />
          <TextInput
            name="occasionDate"
            label={t("fields.occasionDate")}
            type="date"
            error={errorFor("occasionDate")}
          />
          <MobileInput
            name="altMobile"
            label={t("fields.altMobile")}
            error={errorFor("altMobile")}
          />
          <TextInput name="address" label={t("fields.address")} error={errorFor("address")} />
        </div>
      </div>

      {/* Ticked by default (M05.08); the action stores the date and who took it. */}
      <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
        <input
          type="checkbox"
          name="consentGiven"
          defaultChecked
          className="mt-0.5 size-5.5 shrink-0 accent-primary"
        />
        <span>{t("consent")}</span>
      </label>

      <FieldError>{bottomError ? tError(bottomError, errorValues) : undefined}</FieldError>

      <div className="flex flex-col gap-2.5">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <Button asChild variant="secondary">
          <Link href={FIND_PATH}>{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
