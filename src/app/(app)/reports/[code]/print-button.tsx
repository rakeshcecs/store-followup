"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

// R8 "Printable": the browser's own print, with the app's menus left off the page.
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" className="grow" onClick={() => window.print()}>
      <Printer aria-hidden />
      {label}
    </Button>
  );
}
