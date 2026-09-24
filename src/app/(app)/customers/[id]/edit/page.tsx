import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { EditCustomerForm } from "@/app/(app)/customers/[id]/edit/edit-form";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth";
import { canChangeMobile, canEditCustomer, customerProfile } from "@/lib/customers";
import { db } from "@/lib/db";

// Edit details (M06.07). Its own screen rather than a dialog: eight fields do not fit a
// dialog on a phone. The action checks the same rules again; this page only decides
// what to draw.
export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const t = await getTranslations("customers");

  const customer = await customerProfile(id);
  if (!customer) notFound();
  // Someone else's customer: they may read the profile, just not change it.
  if (!canEditCustomer(user, customer)) redirect(`/customers/${customer.id}`);

  // The customer's current department stays offerable even if it was since switched off,
  // or opening the form would silently drop it.
  const departments = await db.department.findMany({
    where: {
      OR: [{ status: "ACTIVE" }, ...(customer.departmentId ? [{ id: customer.departmentId }] : [])],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <AppShell
      role={user.role}
      title={t("edit.title")}
      backHref={`/customers/${customer.id}`}
      backLabel={t("back")}
    >
      <EditCustomerForm
        customer={{
          id: customer.id,
          name: customer.name,
          mobile: customer.mobile ?? "",
          altMobile: customer.altMobile ?? "",
          area: customer.area ?? "",
          city: customer.city ?? "",
          address: customer.address ?? "",
          occasion: customer.occasion ?? "",
          // A @db.Date comes back as UTC midnight; its UTC day is the stored day.
          occasionDate: customer.occasionDate
            ? customer.occasionDate.toISOString().slice(0, 10)
            : "",
          departmentId: customer.departmentId ?? "",
        }}
        departments={departments}
        canChangeMobile={canChangeMobile(user)}
      />
    </AppShell>
  );
}
