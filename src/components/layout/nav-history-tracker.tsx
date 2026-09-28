"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { recordScreen } from "@/lib/nav-history";

// Set by the browser's Back/Forward (and the arrow going back), read by the next screen.
let movedThroughHistory = false;

// Notes every screen the tab lands on, for the back arrows (src/lib/nav-history.ts).
export function NavHistoryTracker() {
  const pathname = usePathname();
  const query = useSearchParams().toString();

  useEffect(() => {
    const onPop = () => {
      movedThroughHistory = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    recordScreen(query ? `${pathname}?${query}` : pathname, movedThroughHistory);
    movedThroughHistory = false;
  }, [pathname, query]);

  return null;
}
