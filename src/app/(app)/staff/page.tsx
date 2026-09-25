import { ArrowRightLeft, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { StaffFilters } from "@/app/(app)/staff/staff-filters";
import { ResetPinButton } from "@/app/(app)/staff/reset-pin-button";
import { AppShell } from "@/components/layout/app-shell";
import { StaffStatusButton } from "@/app/(app)/staff/staff-status-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { formatMobile } from "@/lib/format";
import { normalizeMobile } from "@/lib/mobile";
import { canResetPin, staffBranchWhere } from "@/lib/staff-scope";
import { openWorkFor } from "@/lib/staff-work";
import { firstParam, type SearchValue } from "@/lib/search-params";

// Everyone who may see this screen. Only an admin may change anything on it; a manager
// gets the list and the one power the login screen promises them — resetting a PIN.

type Search = Record<"q" | "role" | "department" | "status", SearchValue>;

// Hand-typed values that are no role or status show everyone, not a 500.
const ROLES = ["SALESPERSON", "MANAGER", "ADMIN"] as const;
const STATUSES = ["ACTIVE", "INACTIVE"] as const;
const oneOf = <T extends string>(list: readonly T[], value: string | undefined) =>
  list.find((item) => item === value);

// Name or mobile. A search that looks like a number is matched against the mobile in the
// shape it is stored, so "98765 43210" and "+91 98765 43210" both find the same person.
function searchWhere(q: string | undefined): Prisma.UserWhereInput {
  const term = q?.trim();
  if (!term) return {};
  const asMobile = normalizeMobile(term);
  return {
    OR: [
      { fullName: { contains: term } },
      { mobile: { contains: (asMobile ?? term.replace(/\D/g, "")) || term } },
    ],
  };
}

export default async function StaffPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  // notFound, not a thrown FORBIDDEN: a salesperson typing this URL should see the same
  // nothing the admin area shows them, not an error page.
  if (user.role === "SALESPERSON") notFound();
  const scope = await getBranchScope(user);
  const params = await searchParams;
  const filters = {
    q: firstParam(params.q),
    role: oneOf(ROLES, firstParam(params.role)),
    department: firstParam(params.department),
    status: oneOf(STATUSES, firstParam(params.status)),
  };
  const t = await getTranslations("staff");

  const isAdmin = user.role === "ADMIN";

  // AND, not two spreads: both are an OR, and the search's would silently replace the
  // branch filter — a manager searching the list then saw every branch's staff.
  const where: Prisma.UserWhereInput = {
    AND: [staffBranchWhere(scope), searchWhere(filters.q)],
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.department ? { departmentId: filters.department } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const [staff, departments] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ status: "asc" }, { fullName: "asc" }],
      select: {
        id: true,
        fullName: true,
        mobile: true,
        role: true,
        status: true,
        department: { select: { name: true } },
        homeBranchId: true,
        extraBranches: { select: { branchId: true } },
        homeBranch: { select: { name: true } },
        // So the list shows what the form set: a manager covering more than one branch
        // is otherwise invisible until somebody opens their edit screen.
        _count: { select: { extraBranches: true } },
      },
    }),
    db.department.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Only for the rows an admin could actually deactivate, to swap the button for the
  // reassign-and-deactivate link — the action checks again before it writes (BR-15).
  const openWork = isAdmin
    ? new Map(
        await Promise.all(
          staff
            .filter((person) => person.status === "ACTIVE")
            .map(async (person) => [person.id, await openWorkFor(db, person.id)] as const),
        ),
      )
    : new Map();

  return (
    <AppShell role={user.role} title={t("title")}>
      <div className="flex flex-wrap gap-2.5">
        {isAdmin && (
          <Button asChild className="grow">
            <Link href="/staff/new">{t("add")}</Link>
          </Button>
        )}
        {/* M15: managers and admins hand customers from one salesperson to another. */}
        <Button asChild variant="secondary" className="grow">
          <Link href="/staff/reassign">
            <ArrowRightLeft aria-hidden />
            {t("reassign")}
          </Link>
        </Button>
      </div>

      <StaffFilters departments={departments} />

      {staff.length === 0 ? (
        <Card className="p-2">
          <EmptyState icon={Users} title={t("empty")} text={t("emptyText")} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {staff.map((person) => {
            const active = person.status === "ACTIVE";
            const open = openWork.get(person.id);
            return (
              <li key={person.id}>
                <Card className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-heading-style text-lg">{person.fullName}</p>
                      <p className="text-[15px] text-muted-foreground">
                        {formatMobile(person.mobile)} · {t(`roles.${person.role}`)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {person.homeBranch.name}
                        {person._count.extraBranches > 0 &&
                          ` · ${t("alsoCovers", { count: person._count.extraBranches })}`}
                      </p>
                      {person.department && (
                        <p className="text-sm text-muted-foreground">{person.department.name}</p>
                      )}
                    </div>
                    <Pill tone={active ? "green" : "grey"}>
                      {active ? t("statusActive") : t("statusInactive")}
                    </Pill>
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    {isAdmin && (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/staff/${person.id}/edit`}>{t("edit")}</Link>
                      </Button>
                    )}
                    {active && canResetPin(user, person) && (
                      <ResetPinButton id={person.id} name={person.fullName} />
                    )}
                    {isAdmin && (
                      <StaffStatusButton
                        id={person.id}
                        name={person.fullName}
                        status={person.status}
                        openCustomers={open?.customers ?? 0}
                        openFollowUps={open?.followUps ?? 0}
                        isSelf={person.id === user.id}
                      />
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
