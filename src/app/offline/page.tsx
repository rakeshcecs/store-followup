import { getLocale } from "next-intl/server";
import en from "../../../messages/en.json";
import gu from "../../../messages/gu.json";
import hi from "../../../messages/hi.json";
import { OfflineApp } from "./offline-app";
import type { Locale } from "@/i18n/config";

// Precached by the service worker, and what it shows for any page that cannot load
// without internet (M19). It carries no customer data — everything shown comes from the
// phone's encrypted copy — and all three languages, because it was cached whenever the
// worker was installed and the person's language may have changed since.
export default async function OfflinePage() {
  const locale = (await getLocale()) as Locale;
  return <OfflineApp messages={{ en, hi, gu }} fallbackLocale={locale} />;
}
