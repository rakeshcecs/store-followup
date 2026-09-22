// Temporary placeholder to check design tokens and fonts. Replaced by real screens (and next-intl text) later.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-4 p-4">
      <h1 className="font-heading-style text-3xl">Follow-up</h1>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-muted-foreground">Setup check</p>
      </div>
      <div className="flex gap-2">
        <span className="h-10 w-10 rounded-lg bg-primary" />
        <span className="h-10 w-10 rounded-lg bg-success" />
        <span className="h-10 w-10 rounded-lg bg-warning" />
        <span className="h-10 w-10 rounded-lg bg-danger" />
      </div>
    </main>
  );
}
