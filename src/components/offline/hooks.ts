"use client";

import { useEffect, useState } from "react";
import { isoDate } from "@/lib/format";
import { onChanged, outboxCounts, readCache, readOutbox } from "@/lib/offline/store";
import type { OfflineCache, OutboxEntry } from "@/lib/offline/types";
import { offlineView, type OfflineView } from "@/lib/offline/view";

// M19: the phone's database, read into React. Everything re-reads when the store says it
// changed — here, in another tab, or in the service worker.

export function useOutboxCounts(): { waiting: number; attention: number } {
  const [counts, setCounts] = useState({ waiting: 0, attention: 0 });
  useEffect(() => {
    let live = true;
    const load = () => void outboxCounts().then((next) => live && setCounts(next));
    load();
    const stop = onChanged(load);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return counts;
}

export type OfflineData =
  | { state: "loading" }
  | { state: "empty" } // no copy on this phone
  | {
      state: "ready";
      cache: OfflineCache;
      outbox: OutboxEntry[];
      view: OfflineView;
      today: string;
    };

export function useOfflineData(): OfflineData {
  const [data, setData] = useState<OfflineData>({ state: "loading" });
  useEffect(() => {
    let live = true;
    const load = async () => {
      const [cache, outbox] = await Promise.all([readCache(), readOutbox()]);
      if (!live) return;
      if (!cache) {
        setData({ state: "empty" });
        return;
      }
      const today = isoDate(new Date());
      setData({ state: "ready", cache, outbox, view: offlineView(cache, outbox, today), today });
    };
    void load();
    const stop = onChanged(() => void load());
    return () => {
      live = false;
      stop();
    };
  }, []);
  return data;
}
