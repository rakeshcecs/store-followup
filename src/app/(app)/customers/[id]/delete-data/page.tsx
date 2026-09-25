import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeleteDataForm } from "@/app/(app)/customers/[id]/delete-data/delete-data-form";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { customerProfile } from "@/lib/customers";

// M16.03: "Delete customer data", admin only, on the customer's own request (DPDP Act
// 2023). Says plainly what goes and what stays before anything is typed.
export default async function DeleteCustomerDataPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "ADMIN") notFound();
  const { id } = await params;
  const customer = await customerProfile(id);
  if (!customer || !customer.mobile) notFound();
  const t = await getTranslations("privacy");

  return (
    <AppShell
      role={user.role}
      title={t("title")}
      backHref={`/customers/${customer.id}`}
      backLabel={t("back")}
    >
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-heading-style text-xl">{customer.name}</h2>
        <p>{t("intro")}</p>
        <ul className="list-disc pl-5 text-[15px]">
          <li>{t("goes")}</li>
          <li>{t("stays")}</li>
          <li>{t("followUps")}</li>
          <li>{t("final")}</li>
        </ul>
      </Card>
      <DeleteDataForm customerId={customer.id} name={customer.name} />
    </AppShell>
  );
}
