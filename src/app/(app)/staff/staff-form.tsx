"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { createStaff, updateStaff } from "@/app/(app)/staff/actions";
import { TempPinDialog } from "@/app/(app)/staff/temp-pin-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import type { Role } from "@/generated/prisma/client";
import { roles } from "@/lib/roles";
import { createStaffInput, updateStaffInput } from "@/lib/validation/staff";

// The list this form returns to, hoisted out of the markup: a path, not text.
const STAFF_LIST = "/staff";

type StaffFormProps = {
  branches: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  staff?: {
    id: string;
    fullName: string;
    mobile: string;
    role: Role;
    homeBranchId: string;
    departmentId: string | null;
    joinedOn: string | null; // already "2026-09-23" for the date input
  };
};

// One component for add and edit, like branch-form.tsx: the only differences are the
// hidden id, which action runs, and the one-time PIN that only a new person gets.
export function StaffForm({ branches, departments, staff }: StaffFormProps) {
  const t = useTranslations("staff");
  const tError = useErrorMessage();
  const router = useRouter();
  const [tempPin, setTempPin] = useState<{ pin: string; name: string } | null>(null);

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
          defaultValue={staff?.role ?? roles[0]}
          options={roles.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
          error={errorFor("role")}
        />
        <Select
          name="homeBranchId"
          label={t("fields.branch")}
          hint={t("hints.branch")}
          defaultValue={staff?.homeBranchId ?? branches[0]?.id}
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          error={errorFor("homeBranchId")}
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
