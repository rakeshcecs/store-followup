"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { PERIODS, type DayRange, type Period } from "@/lib/dashboard-period";

// M12.01: Today (default), Yesterday, This week, This month, Custom dates. The choice
// lives in the address, so a reload, the back button and a shared link all keep it.
export function PeriodPicker({ period, range }: { period: Period; range: DayRange }) {
  const t = useTranslations("overview.period");
  const router = useRouter();
  const [custom, setCustom] = useState(period === "custom");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  function choose(value: Period) {
    if (value === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    router.push(value === "today" ? "/overview" : `/overview?period=${value}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <Select
        label={t("label")}
        options={PERIODS.map((value) => ({ value, label: t(value) }))}
        value={custom ? "custom" : period}
        onChange={(event) => choose(event.target.value as Period)}
      />
      {custom && (
        <form
          className="grid grid-cols-2 items-end gap-2.5 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(`/overview?period=custom&from=${from}&to=${to}`);
          }}
        >
          <TextInput
            type="date"
            label={t("from")}
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
          <TextInput
            type="date"
            label={t("to")}
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            required
          />
          <Button type="submit" className="col-span-2 sm:col-span-1">
            {t("show")}
          </Button>
        </form>
      )}
    </div>
  );
}
