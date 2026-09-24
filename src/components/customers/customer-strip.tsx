import { Avatar } from "@/components/ui/avatar";

// The customer at the top of Record visit (M07.01), Sale (M10) and Set follow-up (M08):
// who this is, and a line of context under the name.
export function CustomerStrip({ name, line }: { name: string; line: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <Avatar name={name} />
      <div className="min-w-0">
        <p className="font-bold">{name}</p>
        <p className="text-sm text-muted-foreground">{line}</p>
      </div>
    </div>
  );
}
