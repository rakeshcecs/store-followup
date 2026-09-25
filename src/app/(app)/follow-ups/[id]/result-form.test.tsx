import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const push = vi.hoisted(() => vi.fn());
const recordResultAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/actions/follow-up", () => ({
  recordFollowUpResult: recordResultAction,
  setFollowUp: vi.fn(),
}));

const { ResultForm } = await import("@/app/(app)/follow-ups/[id]/result-form");

const r = en.followUpResult;
const TODAY = "2026-09-24"; // a Thursday

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <ResultForm
        userId="user-a"
        followUp={{ id: "fu-1", customerId: "cust-1" }}
        reasons={[{ id: "reason-1", name: "Price" }]}
        today={TODAY}
      />
    </NextIntlClientProvider>,
  );
}

const option = (value: keyof typeof r.option) =>
  screen.getByRole("radio", { name: new RegExp(r.option[value].label) });

beforeEach(() => {
  push.mockReset();
  recordResultAction
    .mockReset()
    .mockResolvedValue({ ok: true, data: { followUpId: "fu-1", nextFollowUpId: "fu-2" } });
  window.sessionStorage.clear();
});

describe("ResultForm", () => {
  it("asks what happened before anything can be saved", () => {
    renderForm();
    expect(screen.getByRole("button", { name: r.choose })).toBeDisabled();
  });

  it("offers the visit-day chips for 'will visit' and saves the chosen day", async () => {
    renderForm();

    await userEvent.click(option("WILL_VISIT"));
    expect(screen.getByRole("radio", { name: r.shortcut.SUNDAY })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: r.shortcut.IN_3_DAYS })).not.toBeInTheDocument();

    // No day yet: the screen says so instead of saving.
    await userEvent.click(screen.getByRole("button", { name: r.save }));
    expect(await screen.findByText(en.followUps.errors.pickDate)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: r.shortcut.SUNDAY }));
    expect(screen.getByText(r.nextOn.replace("{date}", "Sun, 27 Sep"))).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(r.note), "With family");
    await userEvent.click(screen.getByRole("button", { name: r.save }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(recordResultAction).toHaveBeenCalledWith({
      id: "fu-1",
      clientId: expect.any(String),
      note: "With family",
      result: "WILL_VISIT",
      nextDate: "2026-09-27",
    });
  });

  it("offers In 3 days for 'call later'", async () => {
    renderForm();

    await userEvent.click(option("CALL_LATER"));
    await userEvent.click(screen.getByRole("radio", { name: r.shortcut.IN_3_DAYS }));
    await userEvent.click(screen.getByRole("button", { name: r.save }));

    await waitFor(() =>
      expect(recordResultAction).toHaveBeenCalledWith(
        expect.objectContaining({ result: "CALL_LATER", nextDate: "2026-09-27" }),
      ),
    );
  });

  it("explains 'not reachable' and needs nothing else", async () => {
    renderForm();

    await userEvent.click(option("NOT_REACHABLE"));
    expect(screen.getByText(/After 3 missed calls/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: r.save }));

    await waitFor(() =>
      expect(recordResultAction).toHaveBeenCalledWith(
        expect.objectContaining({ result: "NOT_REACHABLE" }),
      ),
    );
  });

  it("needs a reason for 'not interested'", async () => {
    renderForm();

    await userEvent.click(option("NOT_INTERESTED"));
    await userEvent.click(screen.getByRole("button", { name: r.save }));
    expect(await screen.findByText(en.visits.errors.reasonRequired)).toBeInTheDocument();
    expect(recordResultAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("radio", { name: "Price" }));
    await userEvent.click(screen.getByRole("button", { name: r.save }));
    await waitFor(() =>
      expect(recordResultAction).toHaveBeenCalledWith(
        expect.objectContaining({ result: "NOT_INTERESTED", lostReasonId: "reason-1" }),
      ),
    );
  });

  it("sends 'already bought' to the sale screen with the note, saving nothing yet", async () => {
    renderForm();

    await userEvent.click(option("ALREADY_BOUGHT"));
    await userEvent.type(screen.getByLabelText(r.note), "Bought on Sunday");
    await userEvent.click(screen.getByRole("button", { name: r.nextBill }));

    expect(push).toHaveBeenCalledWith("/sales/new?customerId=cust-1&followUpId=fu-1");
    expect(recordResultAction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("followup-note:user-a:fu-1")).toBe("Bought on Sunday");
  });

  it("shows the server's refusal", async () => {
    recordResultAction.mockResolvedValue({
      ok: false,
      code: "RULE",
      message: "followUpResult.errors.alreadyUpdated",
    });
    renderForm();

    await userEvent.click(option("NOT_REACHABLE"));
    await userEvent.click(screen.getByRole("button", { name: r.save }));

    expect(await screen.findByText(r.errors.alreadyUpdated)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
