"use client";

import { CalendarCheck, CloudUpload, UserSearch, Wifi } from "lucide-react";
import {
  NextIntlClientProvider,
  useLocale,
  useTranslations,
  type AbstractIntlMessages,
} from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { RetryButton } from "./retry-button";
import {
  CustomerScreen,
  FollowUpScreen,
  NeedsInternet,
  NewCustomerScreen,
  ResultScreen,
  SaleScreen,
  SearchScreen,
  TodayScreen,
  VisitScreen,
} from "./screens";
import { useOfflineData, type OfflineData } from "@/components/offline/hooks";
import { SyncAgent } from "@/components/offline/sync-agent";
import { SyncCenter } from "@/components/offline/sync-center";
import { SyncStatus } from "@/components/offline/sync-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TopBar } from "@/components/ui/top-bar";
import { useOnline } from "@/hooks/use-online";
import { isLocale, timeZone, type Locale } from "@/i18n/config";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { takeSavedFlash } from "@/lib/offline/submit";
import { cn } from "@/lib/utils";

type Messages = Record<Locale, AbstractIntlMessages>;
type Ready = Extract<OfflineData, { state: "ready" }>;

// The address the person asked for. The service worker answered it with this page, so
// the browser still shows the original one.
function useAddress(): URL | null {
  const [url, setUrl] = useState<URL | null>(null);
  useEffect(() => {
    const read = () => setUrl(new URL(window.location.href));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return url;
}

// M19: the app without internet. The service worker shows this page for any address
// that cannot load, and this page draws that address from the phone's encrypted copy:
// Today, Find customer, the customer, and the forms — the same forms as online, whose
// saves go to the outbox. Anything else says it needs internet.
export function OfflineApp({
  messages,
  fallbackLocale,
}: {
  messages: Messages;
  fallbackLocale: Locale;
}) {
  const data = useOfflineData();
  const language = data.state === "ready" ? data.cache.user.language : fallbackLocale;
  const locale: Locale = isLocale(language) ? language : fallbackLocale;

  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone={timeZone}>
      <Workspace data={data} />
    </NextIntlClientProvider>
  );
}

function Workspace({ data }: { data: OfflineData }) {
  const t = useTranslations();
  const url = useAddress();
  const online = useOnline();
  const locale = useLocale() as Locale;
  const ready = data.state === "ready";

  useEffect(() => {
    if (ready && takeSavedFlash()) toast(t("sync.savedOnPhone"));
  }, [ready, t]);

  if (data.state === "loading" || !url) return null;

  if (data.state === "empty") {
    return (
      <main className="mx-auto flex w-full max-w-120 flex-1 flex-col justify-center p-5">
        <Card>
          <EmptyState
            title={t("offlineApp.noData.title")}
            text={t("offlineApp.noData.text")}
            action={<RetryButton label={t("offline.retry")} />}
          />
        </Card>
      </main>
    );
  }

  const screen = route(url, data, t as unknown as (key: string) => string);
  return (
    <div className="mx-auto flex h-dvh w-full max-w-120 flex-col bg-background pt-[env(safe-area-inset-top)]">
      <TopBar
        title={screen.title}
        backLabel={screen.back ? t("customers.back") : undefined}
        backHref={screen.back}
      />
      <SyncStatus />
      {online && (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-md bg-success-light px-3 py-2 text-sm font-bold text-success">
          <Wifi aria-hidden className="size-4.5 shrink-0" />
          <span className="grow">{t("offlineApp.backOnline")}</span>
          <Button asChild size="sm">
            <a href={url.pathname + url.search}>{t("offlineApp.openApp")}</a>
          </Button>
        </div>
      )}
      <SyncAgent branchId={data.cache.branch?.id ?? null} language={data.cache.user.language} />
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-2 pb-6">
        <p className="text-xs text-muted-foreground" data-testid="offline-copy">
          {t("offlineApp.copyFrom", { time: formatDateTime(data.cache.savedAt, locale) })}
        </p>
        {screen.body}
      </main>
      <OfflineNav path={url.pathname} />
    </div>
  );
}

type Screen = { title: string; back?: string; body: ReactNode };

// Titles are the online screens' own keys; tests/unit/message-keys.test.ts checks they exist.
function route(url: URL, data: Ready, t: (key: string) => string): Screen {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const mobile = url.searchParams.get("mobile");
  const draft = url.searchParams.get("draft");
  const followUpId = url.searchParams.get("followUpId");
  const customerId = url.searchParams.get("customerId") ?? "";
  const customerMatch = /^\/customers\/([^/]+)$/.exec(path);
  const followUpMatch = /^\/follow-ups\/([^/]+)$/.exec(path);

  if (["/", "/today", "/offline", "/overview", "/follow-ups"].includes(path)) {
    return { title: t("today.title"), body: <TodayScreen data={data} /> };
  }
  if (path === "/customers") {
    return {
      title: t("customers.title"),
      body: <SearchScreen data={data} mobile={mobile} />,
    };
  }
  if (path === "/customers/new") {
    return {
      title: t("customers.new"),
      back: "/customers",
      body: <NewCustomerScreen data={data} mobile={mobile} />,
    };
  }
  if (path === "/sync") {
    return { title: t("sync.center.title"), body: <SyncCenter /> };
  }
  if (path === "/visits/new") {
    const id = customerId;
    return {
      title: t("visits.new"),
      back: `/customers/${id}`,
      body: <VisitScreen data={data} customerId={id} />,
    };
  }
  if (path === "/follow-ups/new") {
    const id = customerId;
    return {
      title: t("followUps.new"),
      back: `/customers/${id}`,
      body: <FollowUpScreen data={data} customerId={id} draft={draft} />,
    };
  }
  if (path === "/sales/new") {
    const id = customerId;
    return {
      title: t("sales.new"),
      back: `/customers/${id}`,
      body: <SaleScreen data={data} customerId={id} draft={draft} followUpId={followUpId} />,
    };
  }
  if (customerMatch?.[1]) {
    return {
      title: t("customers.profile.title"),
      back: "/customers",
      body: <CustomerScreen data={data} id={decodeURIComponent(customerMatch[1])} />,
    };
  }
  if (followUpMatch?.[1]) {
    return {
      title: t("followUpResult.title"),
      back: "/today",
      body: <ResultScreen data={data} id={decodeURIComponent(followUpMatch[1])} />,
    };
  }
  return { title: t("offline.title"), body: <NeedsInternet /> };
}

// Plain links: offline each one loads this page again from the phone; online it opens
// the real screen.
function OfflineNav({ path }: { path: string }) {
  const t = useTranslations();
  const items = [
    { href: "/today", label: t("nav.today"), icon: <CalendarCheck /> },
    { href: "/customers", label: t("nav.customers"), icon: <UserSearch /> },
    { href: "/sync", label: t("offlineApp.entries"), icon: <CloudUpload /> },
  ];
  return (
    <nav
      aria-label={t("nav.label")}
      className="flex shrink-0 border-t border-border bg-card px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+12px)]"
    >
      {items.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-13 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold text-muted-foreground no-underline [&_svg]:size-6",
              active && "text-primary",
            )}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
