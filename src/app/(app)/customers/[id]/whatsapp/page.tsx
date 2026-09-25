import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { WhatsAppPanel } from "@/app/(app)/customers/[id]/whatsapp/whatsapp-panel";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageStatusTicks } from "@/components/whatsapp/message-status";
import type { Language } from "@/generated/prisma/client";
import type { Locale } from "@/i18n/config";
import { requireUser } from "@/lib/auth";
import { getCurrentBranch } from "@/lib/current-branch";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ALL_BRANCHES } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { fieldValues, windowEndsAt, windowOpen } from "@/lib/whatsapp/send";
import { whatsappConnection } from "@/lib/whatsapp/settings";
import { fillTemplate, renderBody, type FieldValues } from "@/lib/whatsapp/templates";

const SHOWN = 50;

// M22 "Send WhatsApp": from the profile and the follow-up cards. Every role (the
// customer is shared, BR-16). Consent first (BR-19); then an approved message with its
// placeholders filled for this customer, and free text only in the 24-hour window (BR-20).
//
// branch-scope-exempt: the conversation is the customer's, from every branch, like the
// rest of their history.
export default async function CustomerWhatsAppPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const t = await getTranslations("whatsapp");
  const locale = (await getLocale()) as Locale;

  const customer = await db.customer.findFirst({
    where: { id, active: true },
    select: {
      id: true,
      name: true,
      mobile: true,
      whatsappConsent: true,
      whatsappLastInAt: true,
    },
  });
  if (!customer) notFound();

  const now = new Date();
  const branch = await getCurrentBranch(user);
  const [connected, messages, templates] = await Promise.all([
    whatsappConnection().then((connection) => connection !== null),
    db.whatsAppMessage.findMany({
      where: { customerId: customer.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SHOWN,
      select: {
        id: true,
        direction: true,
        kind: true,
        body: true,
        status: true,
        createdAt: true,
        sentById: true,
      },
    }),
    db.whatsAppTemplate.findMany({
      where: { active: true, metaStatus: "APPROVED" },
      orderBy: [{ name: "asc" }, { language: "asc" }],
      select: { id: true, name: true, language: true, body: true, variables: true, mapping: true },
    }),
  ]);

  // Each template, filled for this customer in its own language, or why it cannot be.
  const values = new Map<Language, FieldValues>();
  const options =
    branch === ALL_BRANCHES
      ? []
      : await Promise.all(
          templates.map(async (template) => {
            if (!values.has(template.language)) {
              values.set(
                template.language,
                await fieldValues({
                  customerId: customer.id,
                  branchId: branch,
                  language: template.language,
                }),
              );
            }
            const filled = fillTemplate(template, values.get(template.language)!);
            return {
              id: template.id,
              name: template.name,
              language: template.language,
              preview: filled.ok
                ? renderBody(template.body, template.variables, filled.parameters)
                : null,
              problem: filled.ok
                ? null
                : filled.missing === "unmapped"
                  ? ("notSetUp" as const)
                  : ("cannotUse" as const),
            };
          }),
        );

  const open = windowOpen(customer.whatsappLastInAt, now);
  const end = windowEndsAt(customer.whatsappLastInAt);

  return (
    <AppShell
      role={user.role}
      title={t("title")}
      backHref={`/customers/${customer.id}`}
      backLabel={t("back")}
    >
      <p className="font-heading-style text-xl">{customer.name}</p>
      {!connected && (
        <p className="rounded-md bg-warning-light px-3 py-2.5 text-sm text-warning" role="status">
          {t("notConnected")}
        </p>
      )}
      {branch === ALL_BRANCHES && customer.whatsappConsent ? (
        <Card>
          <EmptyState title={t("pickBranch")} text={t("pickBranchText")} />
        </Card>
      ) : (
        <WhatsAppPanel
          customer={{ id: customer.id, name: customer.name }}
          consent={customer.whatsappConsent && customer.mobile !== null}
          templates={options}
          replyUntil={open && end ? formatDateTime(end, locale) : null}
        />
      )}

      <section className="flex flex-col gap-3" aria-labelledby="whatsapp-conversation">
        <h3 id="whatsapp-conversation" className="font-heading-style text-lg">
          {t("conversation")}
        </h3>
        {messages.length === 0 ? (
          <p className="text-muted-foreground">{t("noMessages")}</p>
        ) : (
          <ol className="flex flex-col gap-2.5" data-testid="whatsapp-conversation">
            {[...messages].reverse().map((message) => {
              const incoming = message.direction === "IN";
              return (
                <li
                  key={message.id}
                  data-testid="whatsapp-message"
                  data-direction={message.direction}
                  className={cn(
                    "max-w-[85%] rounded-xl border px-3.5 py-2.5",
                    incoming
                      ? "self-start border-border bg-card"
                      : "self-end border-primary/20 bg-primary-light",
                  )}
                >
                  <p className="text-[15px] leading-relaxed break-words whitespace-pre-line">
                    {message.body}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                    <span>{formatDateTime(message.createdAt, locale)}</span>
                    {incoming ? (
                      <span>{t("fromCustomer")}</span>
                    ) : (
                      <>
                        {!message.sentById && <span>{t("automatic")}</span>}
                        <MessageStatusTicks
                          status={message.status}
                          label={t(`status.${message.status}`)}
                        />
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </AppShell>
  );
}
