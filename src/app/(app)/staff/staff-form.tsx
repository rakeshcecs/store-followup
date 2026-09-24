"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { createStaff, updateStaff } from "@/app/(app)/staff/actions";
import { TempPinDialog } from "@/app/(app)/staff/temp-pin-dialog";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { FieldError } from "@/components/ui/field-error";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import type { Role } from "@/generated/prisma/client";
import { defaultLocale, languageNames, locales, type Locale } from "@/i18n/config";
import { roles } from "@/lib/roles";
import { createStaffInput, updateStaffInput } from "@/lib/validation/staff";

// The list this form returns to, hoisted out of the markup: a path, not text.
const STAFF_LIST = "/staff";

type StaffFormProps = {
  // The home branch can only be one the admin is currently looking at, so that a new
  // person cannot land in a branch that is not on screen (M03).
  branches: { id: string; name: string }[];
  // Extra branches are the opposite question — which *other* branches this manager also
  // covers — so they come from every branch the admin may reach, not from the current view.
  coverableBranches: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  staff?: {
    id: string;
    fullName: string;
    mobile: string;
    role: Role;
    homeBranchId: string;
    departmentId: string | null;
    joinedOn: string | null; // already "2026-09-23" for the date input
    extraBranchIds: string[];
    language: Locale;
  };
};

// One component for add and edit, like branch-form.tsx: the only differences are the
// hidden id, which action runs, and the one-time PIN that only a new person gets.
export function StaffForm({ branches, coverableBranches, departments, staff }: StaffFormProps) {
  const t = useTranslations("staff");
  const tError = useErrorMessage();
  const router = useRouter();
  const [tempPin, setTempPin] = useState<{ pin: string; name: string } | null>(null);

  // Both are watched rather than read on submit: the extra-branch chips only exist for a
  // manager, and they must never offer the branch the person already works in.
  const [role, setRole] = useState<Role>(staff?.role ?? roles[0]);
  const [homeBranchId, setHomeBranchId] = useState(staff?.homeBranchId ?? branches[0]?.id ?? "");
  const [extraBranchIds, setExtraBranchIds] = useState<string[]>(staff?.extraBranchIds ?? []);

  const canCoverMore = role === "MANAGER";
  const otherBranches = coverableBranches.filter((branch) => branch.id !== homeBranchId);
  // Moving someone's home branch to one of their extras must not leave it in both.
  const extras = extraBranchIds.filter((id) => id !== homeBranchId);

  const { formAction, pending, errors, formError, errorValues } = useActionForm(
    staff ? updateStaff : createStaff,
    staff ? updateStaffInput : createStaffInput,
    (data: { id: string; fullName: string; tempPin?: string }) => {
      if (data.tempPin) {
        // Held on screen until the admin closes it: this is the only time it is readable.
        setTempPin({ pin: data.tempPin, name: data.fullName });
        return;
      }
      toast(t("saved"));
      router.push(STAFF_LIST);
    },
  );

  const errorFor = (field: string) =>
    errors[field] ? tError(errors[field], errorValues) : undefined;

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4.5" noValidate>
        {staff && <input type="hidden" name="id" value={staff.id} />}

        <TextInput
          name="fullName"
          label={t("fields.name")}
          defaultValue={staff?.fullName}
          autoComplete="off"
          error={errorFor("fullName")}
        />
        <TextInput
          name="mobile"
          label={t("fields.mobile")}
          hint={t("hints.mobile")}
          type="tel"
          inputMode="numeric"
          defaultValue={staff?.mobile}
          autoComplete="off"
          error={errorFor("mobile")}
        />
        <Select
          name="role"
          label={t("fields.role")}
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          options={roles.map((value) => ({ value, label: t(`roles.${value}`) }))}
          error={errorFor("role")}
        />
        <Select
          name="homeBranchId"
          label={t("fields.branch")}
          hint={t("hints.branch")}
          value={homeBranchId}
          onChange={(event) => setHomeBranchId(event.target.value)}
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          error={errorFor("homeBranchId")}
        />

        {/* SOW: "Extra branches — for managers covering more than one branch." A
            salesperson works in one shop, and an admin already reaches every branch. */}
        {canCoverMore && otherBranches.length > 0 && (
          <div>
            <span className="mb-2 block text-sm font-bold text-ink-2">
              {t("fields.extraBranches")}
            </span>
            <ChoiceChips
              type="multiple"
              label={t("fields.extraBranches")}
              value={extras}
              onValueChange={setExtraBranchIds}
              options={otherBranches.map((branch) => ({ value: branch.id, label: branch.name }))}
            />
            <p className="mt-1.5 text-sm text-muted-foreground">{t("hints.extraBranches")}</p>
          </div>
        )}
        {/* One comma-separated value, not a multi-select: useActionForm reads the form
            with Object.fromEntries, which would keep only the last of a repeated key. */}
        <input type="hidden" name="extraBranchIds" value={canCoverMore ? extras.join(",") : ""} />

        <Select
          name="language"
          label={t("fields.language")}
          defaultValue={staff?.language ?? defaultLocale}
          options={locales.map((code) => ({ value: code, label: languageNames[code] }))}
          error={errorFor("language")}
        />
        <Select
          name="departmentId"
          label={t("fields.department")}
          placeholder={t("fields.noDepartment")}
          defaultValue={staff?.departmentId ?? ""}
          options={departments.map((department) => ({
            value: department.id,
            label: department.name,
          }))}
          error={errorFor("departmentId")}
        />
        <TextInput
          name="joinedOn"
          label={t("fields.joinedOn")}
          type="date"
          defaultValue={staff?.joinedOn ?? ""}
          error={errorFor("joinedOn")}
        />

        <FieldError>{formError ? tError(formError, errorValues) : undefined}</FieldError>

        <div className="flex flex-col gap-2.5">
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
          <Button asChild variant="secondary">
            <Link href={STAFF_LIST}>{t("cancel")}</Link>
          </Button>
        </div>
      </form>

      {tempPin && (
        <TempPinDialog
          name={tempPin.name}
          pin={tempPin.pin}
          onClose={() => {
            setTempPin(null);
            router.push(STAFF_LIST);
          }}
        />
      )}
    </>
  );
}
