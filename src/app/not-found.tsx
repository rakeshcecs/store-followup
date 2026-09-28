import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

// Every 404 in the reader's language (M18.01): an address that does not exist, and the
// notFound() a screen throws for a role or branch that may not see it. "/" sends each
// role on to its own home screen.
export default async function NotFound() {
  const t = await getTranslations("notFoundPage");

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col justify-center p-5">
      <Card>
        <EmptyState
          icon={SearchX}
          title={t("title")}
          text={t("text")}
          action={
            <Button asChild className="w-full">
              <Link href="/">{t("home")}</Link>
            </Button>
          }
        />
      </Card>
    </main>
  );
}
