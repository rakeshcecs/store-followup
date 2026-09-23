import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope, Noto_Sans_Devanagari, Noto_Sans_Gujarati } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { DevServiceWorkerCleanup } from "@/components/pwa/dev-service-worker-cleanup";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

// latin-ext carries the rupee sign (U+20B9), which plain latin does not.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// Devanagari and Gujarati (M18). Only the script subset is asked for — Latin is
// Manrope's job — and preload is off, so the browser fetches these files only when a
// glyph in their unicode-range is actually painted. An English screen downloads none.
const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
  display: "swap",
  preload: false,
});

const notoGujarati = Noto_Sans_Gujarati({
  variable: "--font-noto-gujarati",
  subsets: ["gujarati"],
  display: "swap",
  preload: false,
});

// viewportFit "cover" lets the app draw under the iPhone notch; screens pad with safe-area insets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2d3a8c",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: t("name"),
    appleWebApp: { capable: true, title: t("name"), statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
    // The app already speaks English, Hindi and Gujarati and has its own language
    // switch, so a browser translating it on top only does harm: it rewrote the
    // switcher's "English / हिन्दी / ગુજરાતી" into one script, and it would happily
    // rewrite customer names, bill numbers and ₹ amounts too.
    other: { google: "notranslate" },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      translate="no"
      className={`${fraunces.variable} ${manrope.variable} ${notoDevanagari.variable} ${notoGujarati.variable} h-full`}
    >
      <head>{process.env.NODE_ENV !== "production" && <DevServiceWorkerCleanup />}</head>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <PwaProvider>
            {children}
            <Toaster />
          </PwaProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
