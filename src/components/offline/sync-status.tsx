"use client";

import { AlertCircle, CheckCircle2, CloudUpload, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useOutboxCounts } from "@/components/offline/hooks";
import { useOnline } from "@/hooks/use-online";
import { SYNC_FINISHED, type SyncFinished } from "@/components/offline/sync-agent";
import { cn } from "@/lib/utils";

const SYNCED_FOR_MS = 3000; // "green 'All synced' for 3 seconds"
const SYNC_PATH = "/sync";

// M19: the strip under the top bar. Grey "Offline – 3 entries waiting", green "All
// synced" for 3 seconds after a sync, red "1 entry needs your attention". Nothing when
// online with nothing waiting.
export function SyncStatus() {
  const t = useTranslations("sync.status");
  const online = useOnline();
  const { waiting, attention } = useOutboxCounts();
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (event: Event) => {
      const summary = (event as CustomEvent<SyncFinished>).detail;
      if (summary.synced === 0 || summary.waiting > 0 || summary.attention > 0) return;
      setSynced(true);
      clearTimeout(timer);
      timer = setTimeout(() => setSynced(false), SYNCED_FOR_MS);
    };
    window.addEventListener(SYNC_FINISHED, done);
    return () => {
      window.removeEventListener(SYNC_FINISHED, done);
      clearTimeout(timer);
    };
  }, []);

  const tone =
    attention > 0 ? "danger" : !online || waiting > 0 ? "grey" : synced ? "success" : null;
  if (!tone) return null;

  const text =
    attention > 0
      ? t("attention", { count: attention })
      : !online
        ? waiting > 0
          ? t("offlineWaiting", { count: waiting })
          : t("offline")
        : waiting > 0
          ? t("waiting", { count: waiting })
          : t("synced");
  const Icon =
    attention > 0 ? AlertCircle : !online ? WifiOff : waiting > 0 ? CloudUpload : CheckCircle2;

  const className = cn(
    "mx-3 mb-1 flex min-h-9 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold no-underline",
    tone === "danger" && "bg-danger-light text-danger",
    tone === "grey" && "bg-grey-light text-ink-2",
    tone === "success" && "bg-success-light text-success",
  );
  const content = (
    <>
      <Icon aria-hidden className="size-4.5 shrink-0" />
      <span>{text}</span>
    </>
  );

  // Entries waiting or needing attention open the list; "All synced" is just news.
  return (
    <div role="status" data-testid="sync-status" data-tone={tone}>
      {waiting + attention > 0 ? (
        <Link href={SYNC_PATH} className={className}>
          {content}
        </Link>
      ) : (
        <p className={className}>{content}</p>
      )}
    </div>
  );
}
