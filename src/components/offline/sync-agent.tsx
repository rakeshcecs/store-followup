"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cacheStamp, outboxCounts, wipeOfflineData } from "@/lib/offline/store";
import { CACHE_REFRESH_MS, refreshCache, syncOutbox, type SyncSummary } from "@/lib/offline/sync";

export const SYNC_FINISHED = "store-followup-sync-finished";
export type SyncFinished = SyncSummary;

const OPENED = "offline-cache-opened"; // sessionStorage: this app open already refreshed

function firstOpen(): boolean {
  try {
    if (window.sessionStorage.getItem(OPENED)) return false;
    window.sessionStorage.setItem(OPENED, "1");
    return true;
  } catch {
    return true;
  }
}

// Sends the outbox and refreshes the offline copy now, and says so to the status strip.
// The copy is stale after 30 minutes, and at once when the person switches branch or
// language: its lists are that branch's, in that language.
export async function syncNow(
  branchId: string | null,
  force = false,
  language?: string,
): Promise<SyncSummary> {
  const summary = await syncOutbox();
  if (summary.state === "done" || summary.state === "busy") {
    const stamp = await cacheStamp();
    const stale =
      !stamp ||
      Date.now() - new Date(stamp.savedAt).getTime() > CACHE_REFRESH_MS ||
      stamp.branchId !== branchId ||
      (language !== undefined && stamp.language !== language);
    if (force || stale || summary.synced > 0) await refreshCache();
  }
  window.dispatchEvent(new CustomEvent<SyncFinished>(SYNC_FINISHED, { detail: summary }));
  return summary;
}

// M19: mounted on every signed-in screen. On app open (online), when the internet comes
// back, and every 30 minutes: send what the phone saved offline, then refresh the copy
// it keeps. It also stands between Log out and unsynced entries: logging out clears the
// phone, so the person is told what would be lost first.
export function SyncAgent({ branchId, language }: { branchId: string | null; language?: string }) {
  const t = useTranslations();
  const [pendingLogout, setPendingLogout] = useState<{ form: HTMLFormElement; count: number }>();
  const allowLogout = useRef(false);

  useEffect(() => {
    const run = (force = false) => {
      if (navigator.onLine) void syncNow(branchId, force, language);
    };
    run(firstOpen());
    const online = () => run();
    window.addEventListener("online", online);
    const timer = setInterval(() => run(true), CACHE_REFRESH_MS);
    return () => {
      window.removeEventListener("online", online);
      clearInterval(timer);
    };
  }, [branchId, language]);

  useEffect(() => {
    // Capture phase on the document: runs before React's own handler for the form's
    // Server Action, so the logout can be held back.
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-nav-action")) return;
      if (allowLogout.current) {
        allowLogout.current = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void outboxCounts().then(async ({ waiting, attention }) => {
        const count = waiting + attention;
        if (count > 0) {
          setPendingLogout({ form, count });
          return;
        }
        await wipeOfflineData();
        allowLogout.current = true;
        form.requestSubmit();
      });
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  return (
    <ConfirmDialog
      open={pendingLogout !== undefined}
      onOpenChange={(open) => !open && setPendingLogout(undefined)}
      title={t("auth.logOut")}
      description={t("sync.logoutWarning", { count: pendingLogout?.count ?? 0 })}
      confirmLabel={t("auth.logOut")}
      cancelLabel={t("sync.center.keep")}
      danger
      onConfirm={() => {
        const form = pendingLogout?.form;
        setPendingLogout(undefined);
        if (!form) return;
        void wipeOfflineData().then(() => {
          allowLogout.current = true;
          form.requestSubmit();
        });
      }}
    />
  );
}
