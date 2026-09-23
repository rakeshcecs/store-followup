import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getUser } from "@/lib/auth";

// Admin-only area. Every action inside checks permissions again on the server;
// this only keeps the screens out of sight.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  // Signed in but not an admin: 404 rather than "forbidden", which would confirm that
  // something is here.
  if (user.role !== "ADMIN") notFound();

  return children;
}
