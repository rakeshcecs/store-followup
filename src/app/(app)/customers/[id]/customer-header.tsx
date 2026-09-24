import { getTranslations } from "next-intl/server";
import { Avatar } from "@/components/ui/avatar";
import { Pill } from "@/components/ui/pill";
import { CUSTOMER_STATUS_TONE } from "@/lib/customer-status";
import type { CustomerProfile } from "@/lib/customers";
import { formatMobile } from "@/lib/format";

// M06.01: who this is, how to reach them, where they stand and who looks after them.
export async function CustomerHeader({ customer }: { customer: CustomerProfile }) {
  const t = await getTranslations("customers.profile");

  const contact = [customer.mobile && formatMobile(customer.mobile), customer.area]
    .filter(Boolean)
    .join(" · ");
  const owner = [customer.departmentName, customer.assignedToName].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <Avatar name={customer.name} size="lg" />
        <div className="min-w-0">
          <h2 className="font-heading-style text-[26px] leading-tight">{customer.name}</h2>
          {contact && <p className="text-[15px] text-muted-foreground">{contact}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone={CUSTOMER_STATUS_TONE[customer.status]}>{t(`status.${customer.status}`)}</Pill>
        <Pill tone="grey">{owner}</Pill>
      </div>
    </div>
  );
}
