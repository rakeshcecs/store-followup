"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { roles } from "@/lib/roles";

type StaffFiltersProps = {
  departments: { id: string; name: string }[];
};

// Query-string keys, kept out of the markup so they read as what they are — the same
// names src/app/(app)/staff/page.tsx reads back off searchParams.
const KEY = {
  search: "q",
  role: "role",
  department: "department",
  status: "status",
} as const;

const STATUS = { active: "ACTIVE", inactive: "INACTIVE" } as const;

// Filters live in the URL, not in component state: "inactive salespeople" can be
// bookmarked, and the server does the filtering, so the whole list is never loaded.
export function StaffFilters({ departments }: StaffFiltersProps) {
  const t = useTranslations("staff");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next}`));
  }

  const current = (key: string) => params.get(key) ?? "";
  const onSelect = (key: string) => (event: { currentTarget: { value: string } }) =>
    set(key, event.currentTarget.value);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="sm:min-w-60 sm:grow">
        <TextInput
          name={KEY.search}
          label={t("filters.search")}
          type="search"
          inputMode="search"
          autoComplete="off"
          defaultValue={current(KEY.search)}
          // On blur and on Enter, not on every keystroke: one query per letter typed
          // would be one query too many on a shop's mobile data.
          onBlur={onSelect(KEY.search)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              set(KEY.search, event.currentTarget.value);
            }
          }}
        />
      </div>

      <Select
        name={KEY.role}
        label={t("filters.role")}
        placeholder={t("filters.any")}
        defaultValue={current(KEY.role)}
        onChange={onSelect(KEY.role)}
        options={roles.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
      />

      <Select
        name={KEY.department}
        label={t("filters.department")}
        placeholder={t("filters.any")}
        defaultValue={current(KEY.department)}
        onChange={onSelect(KEY.department)}
        options={departments.map((department) => ({
          value: department.id,
          label: department.name,
        }))}
      />

      <Select
        name={KEY.status}
        label={t("filters.status")}
        placeholder={t("filters.any")}
        defaultValue={current(KEY.status)}
        onChange={onSelect(KEY.status)}
        options={[
          { value: STATUS.active, label: t("statusActive") },
          { value: STATUS.inactive, label: t("statusInactive") },
        ]}
      />
    </div>
  );
}
