"use client";

import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  createDepartment,
  renameDepartment,
  setDepartmentStatus,
} from "@/app/(admin)/settings/departments/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import { Pill } from "@/components/ui/pill";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import type { RecordStatus } from "@/generated/prisma/client";
import { createDepartmentInput, renameDepartmentInput } from "@/lib/validation/department";

type Department = {
  id: string;
  name: string;
  status: RecordStatus;
  staffCount: number;
  customerCount: number;
};

// Add, rename and activate/deactivate on one screen: a department is a single name, so a
// separate form page for three fields' worth of nothing would only add taps.
export function DepartmentList({ departments }: { departments: Department[] }) {
  const t = useTranslations("departments");
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <DepartmentForm onSaved={() => setEditing(null)} />

      <ul className="flex flex-col gap-3">
        {departments.map((department) => (
          <li key={department.id}>
            <Card className="flex flex-col gap-3 p-4">
              {editing === department.id ? (
                <DepartmentForm department={department} onSaved={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-heading-style text-lg">{department.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {t("counts", {
                          staff: department.staffCount,
                          customers: department.customerCount,
                        })}
                      </p>
                    </div>
                    <Pill tone={department.status === "ACTIVE" ? "green" : "grey"}>
                      {department.status === "ACTIVE" ? t("statusActive") : t("statusInactive")}
                    </Pill>
                  </div>

                  <div className="flex gap-2.5">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(department.id)}>
                      <Pencil aria-hidden />
                      {t("rename")}
                    </Button>
                    <DepartmentStatusButton department={department} />
                  </div>
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DepartmentForm({ department, onSaved }: { department?: Department; onSaved: () => void }) {
  const t = useTranslations("departments");
  const tError = useErrorMessage();

  const { onSubmit, pending, errors, formError, errorValues } = useActionForm(
    department ? renameDepartment : createDepartment,
    department ? renameDepartmentInput : createDepartmentInput,
    () => {
      toast(department ? t("renamed") : t("added"));
      onSaved();
    },
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
      {department && <input type="hidden" name="id" value={department.id} />}
      <div className="grow">
        <TextInput
          name="name"
          label={department ? t("fields.rename") : t("fields.name")}
          defaultValue={department?.name}
          autoComplete="off"
          error={errors.name ? tError(errors.name, errorValues) : undefined}
        />
        <FieldError>{formError ? tError(formError, errorValues) : undefined}</FieldError>
      </div>
      <Button type="submit" disabled={pending} className="sm:w-auto sm:px-6">
        {department ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {department ? t("save") : t("add")}
      </Button>
    </form>
  );
}

function DepartmentStatusButton({ department }: { department: Department }) {
  const t = useTranslations("departments");
  const tError = useErrorMessage();
  const [pending, startTransition] = useTransition();

  const deactivating = department.status === "ACTIVE";
  const inUse = department.staffCount > 0 || department.customerCount > 0;

  function confirm() {
    startTransition(async () => {
      const result = await setDepartmentStatus({
        id: department.id,
        status: deactivating ? "INACTIVE" : "ACTIVE",
      });
      if (result.ok) toast(deactivating ? t("deactivated") : t("activated"));
      else toast.error(tError(result.message, result.values));
    });
  }

  const prefix = deactivating ? "confirmDeactivate" : "confirmActivate";

  return (
    <ConfirmDialog
      trigger={
        <Button variant="secondary" size="sm" disabled={pending}>
          {deactivating ? t("deactivate") : t("activate")}
        </Button>
      }
      title={t(`${prefix}.title`)}
      // A department in use is a warning, not a block (SOW): old records keep pointing at
      // it, it simply stops being offered on new ones.
      description={
        deactivating && inUse
          ? t("confirmDeactivate.inUse", {
              staff: department.staffCount,
              customers: department.customerCount,
            })
          : t(`${prefix}.text`)
      }
      confirmLabel={t(`${prefix}.confirm`)}
      cancelLabel={t(`${prefix}.cancel`)}
      danger={deactivating}
      onConfirm={confirm}
    />
  );
}
