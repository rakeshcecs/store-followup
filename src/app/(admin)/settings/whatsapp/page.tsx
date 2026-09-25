import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import {
  AutomaticForm,
  ConnectionForm,
  TemplateList,
  TestMessageForm,
} from "@/app/(admin)/settings/whatsapp/whatsapp-settings";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptionConfigured } from "@/lib/secret-box";
import { automaticWhatsApp, connectionSummary } from "@/lib/whatsapp/settings";

// Settings → WhatsApp (M22). Admin only: the store has one WhatsApp number.
export default async function WhatsAppSettingsPage() {
  const user = await requireUser({ roles: ["ADMIN"] });
  const t = await getTranslations("whatsapp.settings");
  const tSettings = await getTranslations("settings");
  const tErrors = await getTranslations("whatsapp.errors");

  const [summary, automatic, templates] = await Promise.all([
    connectionSummary(),
    automaticWhatsApp(),
    db.whatsAppTemplate.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }, { language: "asc" }],
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        body: true,
        variables: true,
        mapping: true,
        metaStatus: true,
      },
    }),
  ]);
  const connected =
    summary.phoneNumberId !== "" &&
    summary.wabaId !== "" &&
    summary.hasAccessToken &&
    summary.hasAppSecret &&
    summary.hasVerifyToken;

  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "";
  const protocol =
    head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const webhookUrl = `${protocol}://${host}/api/whatsapp/webhook`;

  return (
    <AppShell
      role={user.role}
      title={t("title")}
      backHref="/settings"
      backLabel={tSettings("title")}
    >
      <section className="flex flex-col gap-3" aria-labelledby="wa-connection">
        <div className="flex items-center gap-2">
          <h2 id="wa-connection" className="font-heading-style text-lg">
            {t("connection")}
          </h2>
          <Pill tone={connected ? "green" : "grey"} data-testid="wa-connected">
            {connected ? t("connected") : t("notConnected")}
          </Pill>
        </div>
        {!encryptionConfigured() && (
          <p role="alert" className="rounded-md bg-danger-light px-3 py-2.5 text-sm text-danger">
            {tErrors("noEncryptionKey")}
          </p>
        )}
        <ConnectionForm summary={summary} />
        <Card className="p-3.5 text-sm">
          <p className="font-bold">{t("webhookUrl")}</p>
          <p className="mt-1 font-mono break-all" data-testid="webhook-url">
            {webhookUrl}
          </p>
        </Card>
        {connected && <TestMessageForm />}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="wa-templates">
        <h2 id="wa-templates" className="font-heading-style text-lg">
          {t("templates")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("templatesHint")}</p>
        <TemplateList
          connected={connected}
          templates={templates.map((template) => ({
            ...template,
            variables: Array.isArray(template.variables) ? (template.variables as string[]) : [],
            mapping: (template.mapping ?? {}) as Record<string, string>,
          }))}
        />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="wa-automatic">
        <h2 id="wa-automatic" className="font-heading-style text-lg">
          {t("automatic")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("automaticHint")}</p>
        <AutomaticForm
          value={automatic}
          templates={templates
            .filter((template) => template.metaStatus === "APPROVED")
            .map((template) => ({
              id: template.id,
              label: `${template.name} · ${template.language.toUpperCase()}`,
            }))}
        />
      </section>
    </AppShell>
  );
}
