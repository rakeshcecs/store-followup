import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const push = vi.hoisted(() => vi.fn());
const setFollowUpAction = vi.hoisted(() => vi.fn());
const recordVisitAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/actions/follow-up", () => ({
  setFollowUp: setFollowUpAction,
  recordFollowUpResult: vi.fn(),
}));
vi.mock("@/lib/actions/visit", () => ({ recordVisit: recordVisitAction }));

const { FollowUpForm } = await import("@/app/(app)/follow-ups/new/follow-up-form");

const f = en.followUps;
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-09-24"; // a Thursday

function renderForm(extra: Partial<Parameters<typeof FollowUpForm>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <FollowUpForm
        userId="user-a"
        customer={{ id: "cust-1", name: "Asha Patel" }}
        draftId={null}
        hasOpenEnquiry
        replaces={null}
        today={TODAY}
        {...extra}
      />
    </NextIntlClientProvider>,
  );
}

const line = (date: string, slot: string) => f.on.replace("{date}", date).replace("{slot}", slot);

beforeEach(() => {
  push.mockReset();
  setFollowUpAction.mockReset().mockResolvedValue({ ok: true, data: { followUpId: "f-1" } });
  recordVisitAction.mockReset().mockResolvedValue({ ok: true, data: { visitId: "v-1" } });
  window.sessionStorage.clear();
});

describe("FollowUpForm", () => {
  it("starts on This Saturday, evening, phone call, and says so in words", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: f.shortcut.SATURDAY })).toBeChecked();
    expect(screen.getByRole("radio", { name: f.slot.EVENING })).toBeChecked();
    expect(screen.getByRole("radio", { name: f.method.CALL })).toBeChecked();
    expect(screen.getByText(line("Sat, 26 Sep", "evening"))).toBeInTheDocument();
  });

  it("updates the line as the date and time change", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("radio", { name: f.shortcut.NEXT_WEEK }));
    await userEvent.click(screen.getByRole("radio", { name: f.slot.MORNING }));

    expect(screen.getByText(line("Mon, 28 Sep", "morning"))).toBeInTheDocument();
  });

  it("offers a date picker that starts at today", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("radio", { name: f.shortcut.PICK }));
    const picker = screen.getByLabelText(f.dateLabel);
    expect(picker).toHaveAttribute("min", TODAY);

    await userEvent.click(screen.getByRole("button", { name: f.save }));
    expect(await screen.findByText(f.errors.pickDate)).toBeInTheDocument();
    expect(setFollowUpAction).not.toHaveBeenCalled();
  });

  it("warns that a pending follow-up will be replaced (M08.06)", () => {
    renderForm({ replaces: "Tue, 22 Sep" });
    expect(screen.getByText(f.replaces.replace("{date}", "Tue, 22 Sep"))).toBeInTheDocument();
  });

  it("adds the follow-up to the open enquiry when there is no visit draft", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("radio", { name: f.method.WHATSAPP }));
    await userEvent.type(screen.getByLabelText(f.reason), "Send photos");
    await userEvent.click(screen.getByRole("button", { name: f.save }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(setFollowUpAction).toHaveBeenCalledWith({
      clientId: expect.any(String),
      customerId: "cust-1",
      followUp: {
        dueDate: "2026-09-26",
        timeSlot: "EVENING",
        method: "WHATSAPP",
        reason: "Send photos",
      },
    });
    expect(recordVisitAction).not.toHaveBeenCalled();
  });

  it("saves the visit draft and the follow-up together (BR-04), then forgets the draft", async () => {
    window.sessionStorage.setItem(
      "visit-draft:user-a:cust-1",
      JSON.stringify({
        userId: "user-a",
        clientId: DRAFT_ID,
        customerId: "cust-1",
        categoryIds: ["cat-1"],
        remarks: "x".repeat(300),
        outcome: "DECIDE_LATER",
      }),
    );
    renderForm({ draftId: DRAFT_ID, hasOpenEnquiry: false });

    // M08.04: the visit's remarks are copied in, cut to the reason's 250.
    expect(screen.getByLabelText(f.reason)).toHaveValue("x".repeat(250));

    await userEvent.click(screen.getByRole("radio", { name: f.shortcut.TOMORROW }));
    await userEvent.click(screen.getByRole("button", { name: f.save }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(recordVisitAction).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: DRAFT_ID,
        outcome: "DECIDE_LATER",
        remarks: "x".repeat(300),
        followUp: expect.objectContaining({ dueDate: "2026-09-25", reason: "x".repeat(250) }),
      }),
    );
    expect(setFollowUpAction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("visit-draft:user-a:cust-1")).toBeNull();
  });

  it("shows the server's message against the date", async () => {
    setFollowUpAction.mockResolvedValue({
      ok: false,
      code: "RULE",
      message: "visits.errors.dueDatePast",
      field: "followUp.dueDate",
    });
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: f.save }));

    expect(await screen.findByText(en.visits.errors.dueDatePast)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("sends the person to Record visit when there is neither a draft nor an open enquiry", () => {
    renderForm({ hasOpenEnquiry: false });

    expect(screen.getByText(f.visitFirst)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: f.recordVisit })).toHaveAttribute(
      "href",
      "/visits/new?customerId=cust-1",
    );
    expect(screen.queryByRole("button", { name: f.save })).not.toBeInTheDocument();
  });
});
