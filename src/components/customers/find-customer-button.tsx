import { UserPlus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// The way into M05 from a landing screen. The prototype puts it at the top of Today;
// manager and admin get the same button on Overview, because the SOW's screen list marks
// Find customer "Used by: All" and their nav has no room for a fifth tab.
export async function FindCustomerButton() {
  const t = await getTranslations("customers");

  return (
    <Button asChild className="min-h-15 text-[17px]">
      <Link href="/customers">
        <UserPlus aria-hidden />
        {t("findCta")}
      </Link>
    </Button>
  );
}
