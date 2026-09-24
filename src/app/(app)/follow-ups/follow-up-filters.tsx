"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";

type FollowUpFiltersProps = {
  staff: { id: string; name: string }[] | null; // null: a salesperson, who sees only their own
};

// The same names src/lib/follow-up-list.ts reads back off the query string.
const KEY = { search: "q", from: "from", to: "to", assignedTo: "assignedTo" } as const;

// The search runs this long after the last key: one query per pause, not per letter,
// which matters on a shop phone on mobile data.
export const SEARCH_DELAY_MS = 400;

// Filters live in the URL, like the staff list: the server filters, so the whole list is
// never loaded, and "Amit's overdue follow-ups" can be bookmarked.
export function FollowUpFilters({ staff }: FollowUpFiltersProps) {
  const t = useTranslations("followUps.list.filters");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function set(key: string, value: string) {
    // The address bar, not the params of the last render: a search that fires 400 ms
    // after the tab changed must keep the new tab.
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("limit"); // a new filter starts again from the first page
    startTransition(() => router.replace(`${pathname}?${next}`));
  }

  const current = (key: string) => params.get(key) ?? "";

  // Typing searches by itself after a pause; Enter (the phone keyboard's search key) and
  // leaving the box search at once. Unchanged text never costs a request.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function search(value: string, delay: number) {
    clearTimeout(timer.current);
    const term = value.trim();
    if (term === current(KEY.search)) return;
    if (delay === 0) set(KEY.search, term);
    else timer.current = setTimeout(() => set(KEY.search, term), delay);
  }
  const onChange = (key: string) => (event: { currentTarget: { value: string } }) =>
    set(key, event.currentTarget.value);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="sm:min-w-60 sm:grow">
        <TextInput
          name={KEY.search}
          label={t("search")}
          type="search"
          inputMode="search"
          autoComplete="off"
          defaultValue={current(KEY.search)}
          onChange={(event) => search(event.currentTarget.value, SEARCH_DELAY_MS)}
          onBlur={(event) => search(event.currentTarget.value, 0)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search(event.currentTarget.value, 0);
            }
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextInput
          name={KEY.from}
          label={t("from")}
          type="date"
          defaultValue={current(KEY.from)}
          onChange={onChange(KEY.from)}
        />
        <TextInput
          name={KEY.to}
          label={t("to")}
          type="date"
          defaultValue={current(KEY.to)}
          onChange={onChange(KEY.to)}
        />
      </div>

      {staff && (
        <Select
          name={KEY.assignedTo}
          label={t("assignedTo")}
          defaultValue={current(KEY.assignedTo)}
          onChange={onChange(KEY.assignedTo)}
          options={[
            { value: "", label: t("anyone") },
            ...staff.map((person) => ({ value: person.id, label: person.name })),
          ]}
        />
      )}
    </div>
  );
}
