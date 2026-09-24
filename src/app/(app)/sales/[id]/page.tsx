import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelSale } from "@/app/(app)/sales/[id]/cancel-sale";
import { SaleEditForm } from "@/app/(app)/sales/[id]/sale-edit-form";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatMoney, isoDate } from "@/lib/format";
import { accessScope, branchWhere } from "@/lib/permissions";
import { billAmountRequired } from "@/lib/settings";
import { staffBranchWhere } from "@/lib/staff-scope";

// A saved sale (M10.09). Only a manager or an admin comes here — from the "Sale completed"
// row in the customer's history — to correct it or cancel it, always with a reason. The
// sale is read through every branch they work in, not only the one the switcher shows, so
// only a sale in a branch they do not work in is not found (M17).
export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  // A wrong role is "not found", not an error page (a thrown FORBIDDEN renders a 500).
  if (user.role === "SALESPERSON") notFound();
  const { id } = await params;
  const t = await getTranslations("sales");
  const locale = (await getLocale()) as Locale;

  const sale = await db.sale.findFirst({
    where: { id, ...branchWhere(accessScope(user)) },
    select: {
      id: true,
      branchId: true,
      billNumber: true,
      billDate: true,
      billAmount: true,
      remarks: true,
      salespersonId: true,
      cancelled: true,
      cancelReason: true,
      cancelledAt: true,
      cancelledById: true,
      customer: { select: { id: true, name: true } },
      branch: { select: { name: true } },
      salesperson: { select: { fullName: true } },
    },
  });
  if (!sale) notFound();

  // Sale.cancelledById has no relation in the schema, so the name is a second read.
  const cancelledBy = sale.cancelledById
    ? await db.user.findUnique({ where: { id: sale.cancelledById }, select: { fullName: true } })
    : null;

  // Whoever gets the credit must work in the sale's branch.
  const staff = sale.cancelled
    ? []
    : await db.user.findMany({
        where: {
          status: "ACTIVE",
          ...staffBranchWhere({ all: false, branchIds: [sale.branchId] }),
        },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true },
      });

  const rows: [string, string][] = [
    [t("detail.customer"), sale.customer.name],
    [t("detail.branch"), sale.branch.name],
    [t("billDate"), formatDate(sale.billDate, locale)],
    [
      t("amount"),
      sale.billAmount === null ? t("detail.noAmount") : formatMoney(sale.billAmount, locale),
    ],
    [t("detail.salesperson"), sale.salesperson.fullName],
    ...(sale.remarks ? [[t("detail.remarks"), sale.remarks] as [string, string]] : []),
  ];

  return (
    <AppShell
      role={user.role}
      title={t("detail.title")}
      backHref={`/customers/${sale.customer.id}`}
      backLabel={t("back")}
    >
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-heading-style text-2xl">{sale.billNumber}</p>
          {sale.cancelled && <Pill tone="grey">{t("detail.cancelled")}</Pill>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold">
                {label === t("detail.customer") ? (
                  <Link href={`/customers/${sale.customer.id}`}>{value}</Link>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
        {sale.cancelled && sale.cancelledAt && (
          <p className="rounded-md bg-grey-light px-3 py-2 text-sm">
            {t("detail.cancelledBy", {
              name: cancelledBy?.fullName ?? "",
              date: formatDate(sale.cancelledAt, locale),
              reason: sale.cancelReason ?? "",
            })}
          </p>
        )}
      </Card>

      {!sale.cancelled && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="font-heading-style text-lg">{t("detail.edit")}</h2>
            <SaleEditForm
              sale={{
                id: sale.id,
                billNumber: sale.billNumber,
                billDate: isoDate(sale.billDate),
                billAmount: sale.billAmount === null ? "" : String(Number(sale.billAmount)),
                salespersonId: sale.salespersonId,
              }}
              staff={staff.map((person) => ({ id: person.id, name: person.fullName }))}
              amountRequired={await billAmountRequired()}
              today={isoDate(new Date())}
            />
          </section>
          <CancelSale saleId={sale.id} />
        </>
      )}
    </AppShell>
  );
}
