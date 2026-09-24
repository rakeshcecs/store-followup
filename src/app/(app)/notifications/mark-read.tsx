"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { markAllRead } from "@/lib/actions/notifications";

// M14.06: opening the list marks everything read. Done after the page has shown which
// ones were new, then the bell's count is refreshed.
export function MarkAllRead({ unread }: { unread: number }) {
  const router = useRouter();
  useEffect(() => {
    if (unread === 0) return;
    void markAllRead({}).then((result) => {
      if (result.ok) router.refresh();
    });
  }, [unread, router]);
  return null;
}
