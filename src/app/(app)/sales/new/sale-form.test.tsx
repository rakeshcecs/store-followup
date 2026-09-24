import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const push = vi.hoisted(() => vi.fn());
const checkBillAction = vi.hoisted(() => vi.fn());
const recordSaleAction = vi.hoisted(() => vi.fn());
const recordVisitAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/actions/sale", () => ({ checkBill: checkBillAction, recordSale: recordSaleAction }));
vi.mock("@/lib/actions/visit", () => ({ recordVisit: recordVisitAction }));

const { SaleForm } = await import("@/app/(app)/sales/new/sale-form");

const s = en.sales;
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";

function renderForm(extra: Partial<Parameters<typeof SaleForm>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SaleForm
        userId="user-a"
        customer={{ id: "cust-1", name: "Asha Patel" }}
        draftId={null}
        followUpId={null}
        openEnquiryTitle="Sherwani, Wedding Clothes"
        amountRequired
        today="2026-09-24"
        {...extra}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  checkBillAction.mockReset().mockResolvedValue({ ok: true, data: { free: true } });
  recordSaleAction.mockReset().mockResolvedValue({ ok: true, data: { saleId: "s-1" } });
  recordVisitAction.mockReset().mockResolvedValue({ ok: true, data: { visitId: "v-1" } });
  window.sessionStorage.clear();
});

describe("SaleForm", () => {
  it("asks for the bill number before anything can be saved", () => {
    renderForm();
    expect(screen.getByRole("button", { name: s.enterBill })).toBeDisabled();
  });

  it("says a new number is ready, after checking it with the server", async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(s.billNumber), "inv-9");

    expect(await screen.findByText(s.billFree)).toBeInTheDocument();
    expect(checkBillAction).toHaveBeenLastCalledWith({ billNumber: "INV-9" });
    expect(screen.getByRole("button", { name: s.save })).toBeEnabled();
  });

  it("blocks a number already saved, naming the customer and the date", async () => {
    checkBillAction.mockResolvedValue({
      ok: true,
      data: { free: false, name: "Meena Shah", date: "19 Sep 2026" },
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(s.billNumber), "INV-24560");

    expect(
      await screen.findByText(
        en.visits.errors.billTaken.replace("{name}", "Meena Shah").replace("{date}", "19 Sep 2026"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: s.fixBill })).toBeDisabled();
  });

  it("follows the amount setting in its label and before saving", async () => {
    renderForm();
    expect(screen.getByLabelText(s.amount)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(s.billNumber), "INV-1");
    await screen.findByText(s.billFree);
    await userEvent.click(screen.getByRole("button", { name: s.save }));

    expect(await screen.findByText(en.visits.errors.billAmountRequired)).toBeInTheDocument();
    expect(recordSaleAction).not.toHaveBeenCalled();
  });

  it("labels the amount optional when the setting is off", () => {
    renderForm({ amountRequired: false });
    expect(screen.getByLabelText(s.amountOptional)).toBeInTheDocument();
  });

  it("adds the sale to the open enquiry when there is no visit draft", async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(s.billNumber), "inv-2");
    await userEvent.type(screen.getByLabelText(s.amount), "4500");
    await screen.findByText(s.billFree);
    await userEvent.click(screen.getByRole("button", { name: s.save }));

    await waitFor(() =>
      expect(recordSaleAction).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: "cust-1",
          sale: expect.objectContaining({ billNumber: "INV-2", billAmount: "4500" }),
        }),
      ),
    );
    expect(recordVisitAction).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("completes the follow-up it came from, with its note (M09.07)", async () => {
    window.sessionStorage.setItem("followup-note:user-a:fu-1", "Bought on Sunday");
    renderForm({ followUpId: "fu-1" });

    await userEvent.type(screen.getByLabelText(s.billNumber), "inv-3");
    await userEvent.type(screen.getByLabelText(s.amount), "900");
    await screen.findByText(s.billFree);
    await userEvent.click(screen.getByRole("button", { name: s.save }));

    await waitFor(() =>
      expect(recordSaleAction).toHaveBeenCalledWith(
        expect.objectContaining({ followUpId: "fu-1", followUpNote: "Bought on Sunday" }),
      ),
    );
    expect(window.sessionStorage.getItem("followup-note:user-a:fu-1")).toBeNull();
  });

  it("saves the visit draft and the sale together (BR-03), then forgets the draft", async () => {
    window.sessionStorage.setItem(
      "visit-draft:user-a:cust-1",
      JSON.stringify({
        userId: "user-a",
        clientId: DRAFT_ID,
        customerId: "cust-1",
        categoryIds: ["cat-1"],
        remarks: "Liked the blue one",
        outcome: "PURCHASED",
      }),
    );
    renderForm({ draftId: DRAFT_ID, openEnquiryTitle: null });

    await userEvent.type(screen.getByLabelText(s.billNumber), "inv-3");
    await userEvent.type(screen.getByLabelText(s.amount), "900");
    await screen.findByText(s.billFree);
    await userEvent.click(screen.getByRole("button", { name: s.save }));

    await waitFor(() =>
      expect(recordVisitAction).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: DRAFT_ID,
          categoryIds: ["cat-1"],
          remarks: "Liked the blue one",
          outcome: "PURCHASED",
          sale: expect.objectContaining({ billNumber: "INV-3" }),
        }),
      ),
    );
    expect(recordSaleAction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("visit-draft:user-a:cust-1")).toBeNull();
  });

  it("sends the person to Record visit when there is neither a draft nor an open enquiry", () => {
    renderForm({ openEnquiryTitle: null });

    expect(screen.getByText(s.visitFirst)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: s.recordVisit })).toHaveAttribute(
      "href",
      "/visits/new?customerId=cust-1",
    );
  });
});
