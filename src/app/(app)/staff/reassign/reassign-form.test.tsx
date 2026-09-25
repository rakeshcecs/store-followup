import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";
import { ReassignForm, type ReassignFormRow } from "@/app/(app)/staff/reassign/reassign-form";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ toast }));
const reassignCustomers = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true as const,
    data: { customers: 2, followUps: 3, deactivated: false },
  })),
);
vi.mock("@/lib/actions/reassign", () => ({ reassignCustomers }));

const r = en.reassign;
const rows: ReassignFormRow[] = [
  { id: "c1", name: "Rajesh Patel", detail: "Wedding", followUps: 1 },
  { id: "c2", name: "Neha Shah", detail: "Kids", followUps: 2 },
  { id: "c3", name: "Meena Joshi", detail: "Saree", followUps: 0 },
];

function show(props: Partial<Parameters<typeof ReassignForm>[0]> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <ReassignForm
        sources={[{ value: "amit", label: "Amit" }]}
        from={{ id: "amit", name: "Amit" }}
        targets={[{ value: "priya", label: "Priya" }]}
        rows={rows}
        preselected={[]}
        backTo={null}
        exit={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  reassignCustomers.mockClear();
  router.push.mockClear();
  router.refresh.mockClear();
});

describe("ReassignForm (M15)", () => {
  it("counts what is ticked, and asks with the module's sentence before moving", async () => {
    show();
    const button = () => screen.getByRole("button", { name: /Reassign/ });
    expect(button()).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/Rajesh Patel/));
    await userEvent.click(screen.getByLabelText(/Neha Shah/));
    await userEvent.selectOptions(screen.getByLabelText(r.to), "priya");
    expect(button()).toHaveTextContent("Reassign 2 customers");

    await userEvent.click(button());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Move 2 customers and 3 pending follow-ups from Amit to Priya?",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: r.confirm }));
    expect(reassignCustomers).toHaveBeenCalledWith({
      fromId: "amit",
      toId: "priya",
      customerIds: ["c1", "c2"],
      deactivate: false,
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("Select all ticks and unticks every customer", async () => {
    show();
    const all = screen.getByLabelText(r.selectAll.replace("{count}", "3"));
    await userEvent.click(all);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(4);
    await userEvent.click(all);
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  });

  it("from a profile, goes back to that customer afterwards", async () => {
    show({ preselected: ["c2"], backTo: "/customers/c2" });
    await userEvent.selectOptions(screen.getByLabelText(r.to), "priya");
    await userEvent.click(screen.getByRole("button", { name: "Reassign 1 customer" }));
    await userEvent.click(screen.getByRole("button", { name: r.confirm }));
    expect(router.push).toHaveBeenCalledWith("/customers/c2");
  });

  it("staff exit: everything is ticked, nothing can be unticked, and it says they leave", async () => {
    show({ preselected: rows.map((row) => row.id), exit: true });
    expect(screen.queryByLabelText(r.selectAll.replace("{count}", "3"))).not.toBeInTheDocument();
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(r.to), "priya");
    await userEvent.click(
      screen.getByRole("button", { name: "Reassign all and make Amit inactive" }),
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Amit is then made inactive and logged out.",
    );
    await userEvent.click(screen.getByRole("button", { name: r.confirm }));
    expect(reassignCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ customerIds: ["c1", "c2", "c3"], deactivate: true }),
    );
  });

  it("says so when there is nobody to give them to", () => {
    show({ targets: [] });
    expect(screen.getByText(r.noTargets)).toBeInTheDocument();
  });
});
