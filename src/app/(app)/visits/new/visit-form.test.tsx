import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const push = vi.hoisted(() => vi.fn());
const recordVisitAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/actions/visit", () => ({ recordVisit: recordVisitAction }));

const { VisitForm } = await import("@/app/(app)/visits/new/visit-form");
const { readVisitDraft } = await import("@/lib/visit-draft");

const categories = [
  { id: "cat-1", name: "Sherwani" },
  { id: "cat-2", name: "Wedding clothes" },
];
const reasons = [{ id: "r-1", name: "Price too high" }];

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <VisitForm userId="user-a" customerId="cust-1" categories={categories} reasons={reasons} />
    </NextIntlClientProvider>,
  );
}

const v = en.visits;

beforeEach(() => {
  push.mockReset();
  recordVisitAction.mockReset();
  window.sessionStorage.clear();
});

describe("VisitForm", () => {
  it("keeps the button disabled until an answer is chosen, then names the next step", async () => {
    renderForm();

    expect(screen.getByRole("button", { name: v.chooseAnswer })).toBeDisabled();
    await userEvent.click(
      screen.getByRole("radio", { name: new RegExp(v.outcome.PURCHASED.label) }),
    );
    expect(screen.getByRole("button", { name: v.nextBill })).toBeEnabled();
    await userEvent.click(
      screen.getByRole("radio", { name: new RegExp(v.outcome.DECIDE_LATER.label) }),
    );
    expect(screen.getByRole("button", { name: v.nextFollowUp })).toBeEnabled();
    await userEvent.click(
      screen.getByRole("radio", { name: new RegExp(v.outcome.NOT_INTERESTED.label) }),
    );
    expect(screen.getByRole("button", { name: v.saveAndClose })).toBeEnabled();
  });

  it("asks for a category before anything else", async () => {
    renderForm();

    await userEvent.click(
      screen.getByRole("radio", { name: new RegExp(v.outcome.PURCHASED.label) }),
    );
    await userEvent.click(screen.getByRole("button", { name: v.nextBill }));

    expect(await screen.findByText(v.errors.categoryRequired)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("asks for a reason when not interested", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Sherwani" }));
    await userEvent.click(
      screen.getByRole("radio", { name: new RegExp(v.outcome.NOT_INTERESTED.label) }),
    );
    await userEvent.click(screen.getByRole("button", { name: v.saveAndClose }));

    expect(await screen.findByText(v.errors.reasonRequired)).toBeInTheDocument();
    expect(recordVisitAction).not.toHaveBeenCalled();
  });

  it("saves a not-interested visit and goes home", async () => {
    recordVisitAction.mockResolvedValue({
      ok: true,
      data: { visitId: "v-1", customerId: "cust-1" },
    });
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Sherwani" }));
    await userEvent.type(screen.getByLabelText(v.remarks), "Too costly");
    await userEvent.click(
      screen.getByRole("radio", { name: new RegExp(v.outcome.NOT_INTERESTED.label) }),
    );
    await userEvent.click(screen.getByRole("radio", { name: "Price too high" }));
    await userEvent.click(screen.getByRole("button", { name: v.saveAndClose }));

    await waitFor(() =>
      expect(recordVisitAction).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "cust-1",
          categoryIds: ["cat-1"],
          remarks: "Too costly",
          outcome: "NOT_INTERESTED",
          lostReasonId: "r-1",
        }),
      ),
    );
    expect(push).toHaveBeenCalledWith("/");
  });

  it("does not save a bought visit: it keeps a draft and goes to the sale screen", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Wedding clothes" }));
    await userEvent.click(
      screen.getByRole("radio", { name: new RegExp(v.outcome.PURCHASED.label) }),
    );
    await userEvent.click(screen.getByRole("button", { name: v.nextBill }));

    expect(recordVisitAction).not.toHaveBeenCalled();
    const draft = readVisitDraft("user-a", "cust-1");
    expect(draft).toMatchObject({ categoryIds: ["cat-2"], outcome: "PURCHASED" });
    expect(push).toHaveBeenCalledWith(`/sales/new?customerId=cust-1&draft=${draft?.clientId}`);
  });

  it("picks the draft up again when the person comes back", async () => {
    window.sessionStorage.setItem(
      "visit-draft:user-a:cust-1",
      JSON.stringify({
        userId: "user-a",
        clientId: "11111111-1111-4111-8111-111111111111",
        customerId: "cust-1",
        categoryIds: ["cat-1"],
        remarks: "Coming Sunday",
        outcome: "DECIDE_LATER",
      }),
    );
    renderForm();

    expect(await screen.findByDisplayValue("Coming Sunday")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sherwani" })).toHaveAttribute("data-state", "on");
    expect(screen.getByRole("button", { name: v.nextFollowUp })).toBeEnabled();
  });

  it("does not show one person's draft to the next person on the same phone", async () => {
    // Salesperson B signs in on the tab where A left a half-recorded visit.
    window.sessionStorage.setItem(
      "visit-draft:user-b:cust-1",
      JSON.stringify({
        userId: "user-b",
        clientId: "22222222-2222-4222-8222-222222222222",
        customerId: "cust-1",
        categoryIds: ["cat-1"],
        remarks: "Written by someone else",
        outcome: "PURCHASED",
      }),
    );
    renderForm();

    expect(screen.queryByDisplayValue("Written by someone else")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: v.chooseAnswer })).toBeDisabled();
  });
});
