import { redirect } from "next/navigation";
import { getUser, landingPath } from "@/lib/auth";

// Nothing lives at "/" itself: it sends each person to the screen their role owns.
// proxy.ts already bounces signed-out visitors to /login; this repeats the check,
// because the proxy is a convenience and never the guard.
export default async function Home() {
  const user = await getUser();
  redirect(user ? landingPath(user.role) : "/login");
}
