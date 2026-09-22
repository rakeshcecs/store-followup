"use client";

import { BarChart3, CalendarClock, House, LogOut, SearchX, UserCog, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ManagerShell } from "@/components/layout/manager-shell";
import { SalesShell } from "@/components/layout/sales-shell";
import { InstallHelp } from "@/components/pwa/install-help";
import { OnlineStatus } from "@/components/pwa/online-status";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { OptionList } from "@/components/ui/option-list";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { TopBar } from "@/components/ui/top-bar";

const salesNav = [
  { href: "/dev/components", label: "Today", icon: <House /> },
  { href: "/dev/customers", label: "Customers", icon: <Users /> },
  { href: "/dev/follow-ups", label: "Follow-ups", icon: <CalendarClock /> },
];
const managerNav = [
  { href: "/dev/components", label: "Overview", icon: <BarChart3 /> },
  { href: "/dev/customers", label: "Customers", icon: <Users /> },
  { href: "/dev/staff", label: "Staff", icon: <UserCog /> },
];
const logOut = { label: "Log out", icon: <LogOut />, action: () => void toast("Log out tapped") };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-extrabold text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

export function ComponentsDemo() {
  const [slot, setSlot] = useState("EVENING");
  const [categories, setCategories] = useState<string[]>(["SAREE"]);
  const [outcome, setOutcome] = useState("DECIDE_LATER");
  const [confirmed, setConfirmed] = useState(0);

  return (
    <div className="mx-auto flex w-full max-w-300 flex-col gap-8 p-5">
      <div className="mx-auto flex w-full max-w-120 flex-col gap-8">
        <h1 className="font-heading-style text-3xl">Components</h1>

        <Section title="Button">
          <Button>Save sale</Button>
          <Button variant="secondary">Cancel</Button>
          <Button disabled>Save sale (disabled)</Button>
          <div className="flex gap-2">
            <Button size="sm">Small primary</Button>
            <Button size="sm" variant="secondary">
              Small secondary
            </Button>
          </div>
        </Section>

        <Section title="TextInput / TextArea / Select / FieldError">
          <TextInput label="Mobile number" inputMode="numeric" placeholder="98765 43210" />
          <TextInput
            label="Bill number"
            defaultValue="INV-1001"
            error="This bill number is already used in this branch."
          />
          <TextInput label="Customer name" hint="As the customer says it." />
          <TextArea label="Remarks" placeholder="What did the customer like?" />
          <Select
            label="Lost reason"
            placeholder="Choose a reason"
            defaultValue=""
            options={[
              { value: "price", label: "Price" },
              { value: "design", label: "Design not available" },
              { value: "size", label: "Size not available" },
            ]}
          />
          <FieldError>Standalone field error.</FieldError>
        </Section>

        <Section title="ChoiceChips (single / multi)">
          <ChoiceChips
            type="single"
            label="Time slot"
            value={slot}
            onValueChange={setSlot}
            options={[
              { value: "MORNING", label: "Morning" },
              { value: "AFTERNOON", label: "Afternoon" },
              { value: "EVENING", label: "Evening" },
            ]}
          />
          <ChoiceChips
            type="multiple"
            label="Requirement"
            value={categories}
            onValueChange={setCategories}
            options={[
              { value: "WEDDING", label: "Wedding Clothes" },
              { value: "SHERWANI", label: "Sherwani" },
              { value: "SAREE", label: "Saree" },
              { value: "SUIT", label: "Suit" },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Selected: {slot} / {categories.join(", ") || "none"}
          </p>
        </Section>

        <Section title="OptionList">
          <OptionList
            label="Visit outcome"
            value={outcome}
            onValueChange={setOutcome}
            options={[
              { value: "PURCHASED", label: "Purchased", description: "Enter the bill number next" },
              { value: "DECIDE_LATER", label: "Will decide later", description: "Set a follow-up" },
              { value: "NOT_INTERESTED", label: "Not interested", description: "Choose a reason" },
            ]}
          />
        </Section>

        <Section title="Card / Avatar / Pill">
          <Card className="flex items-center gap-3 p-4">
            <Avatar name="Ramesh Kumar Patel" />
            <div className="grow">
              <p className="font-extrabold">Ramesh Kumar Patel</p>
              <p className="text-sm text-muted-foreground">98765 43210 · Navrangpura</p>
            </div>
            <Pill tone="red">Overdue</Pill>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Pill tone="blue">Today</Pill>
            <Pill tone="red">Overdue</Pill>
            <Pill tone="green">Sale done</Pill>
            <Pill tone="grey">Closed</Pill>
            <Pill tone="amber">Warm</Pill>
          </div>
          <div className="flex gap-2">
            <Avatar name="सीता" />
            <Avatar name="ભાવેશ શાહ" />
            <Avatar name="Asha Rao" size="lg" />
          </div>
        </Section>

        <Section title="Toast / ConfirmDialog">
          <Button variant="secondary" onClick={() => toast("Follow-up saved")}>
            Show toast
          </Button>
          <ConfirmDialog
            trigger={<Button variant="secondary">Open confirm</Button>}
            title="Cancel this sale?"
            description="The sale stays in the history as cancelled. This cannot be undone."
            confirmLabel="Cancel sale"
            cancelLabel="Keep sale"
            danger
            onConfirm={() => setConfirmed((n) => n + 1)}
          />
          <p className="text-sm text-muted-foreground">Confirmed {confirmed} time(s).</p>
        </Section>

        <Section title="EmptyState">
          <Card>
            <EmptyState
              icon={SearchX}
              title="No customer found"
              text="Check the number or add a new customer."
              action={<Button size="sm">Add new customer</Button>}
            />
          </Card>
        </Section>

        <Section title="InstallHelp (hidden on desktop Chrome until installable, and when installed)">
          <InstallHelp />
        </Section>

        <Section title="TopBar">
          <Card className="overflow-hidden">
            <TopBar
              title="Customer"
              backLabel="Go back"
              backHref="/dev/components"
              statusSlot={<OnlineStatus />}
            />
          </Card>
        </Section>

        <Section title="SalesShell (salesperson, max 480px) + BottomNav">
          <div className="h-130 overflow-hidden rounded-xl border border-border *:data-[slot=sales-shell]:h-full">
            <SalesShell
              topBar={<TopBar title="Today" />}
              navLabel="Main"
              navItems={salesNav}
              navAction={logOut}
            >
              <Card className="p-4">Screen content scrolls here.</Card>
            </SalesShell>
          </div>
        </Section>
      </div>

      <Section title="ManagerShell (side menu on laptop, bottom menu on phone)">
        <div className="h-130 overflow-hidden rounded-xl border border-border *:data-[slot=manager-shell]:h-full">
          <ManagerShell
            appTitle="Follow-up"
            topBar={<TopBar title="Store overview" />}
            navLabel="Main"
            navItems={managerNav}
            navAction={logOut}
          >
            <Card className="p-4">Widen the window to laptop size to see the side menu.</Card>
          </ManagerShell>
        </div>
      </Section>
    </div>
  );
}
