import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getUser } from "@/lib/auth";

// Every signed-in screen outside the admin area. The check is repeated in each page and
// action; this one exists so a missing or stale session shows the login screen instead of
// an error page. src/proxy.ts cannot do it: it only sees that a cookie exists, not
// whether the session behind it is still alive.
export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await getUser())) redirect("/login");
  return children;
}
