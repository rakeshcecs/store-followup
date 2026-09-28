import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

const suggestFields = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/ai", () => ({ suggestFields }));

const { AiFillPanel } = await import("@/components/ai/ai-fill-panel");

const a = en.ai;

function renderPanel(props: Partial<Parameters<typeof AiFillPanel>[0]> = {}) {
  const onApply = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AiFillPanel screen="visit" customerId="cust-1" enabled onApply={onApply} {...props} />
    </NextIntlClientProvider>,
  );
  return { onApply };
}

beforeEach(() => suggestFields.mockReset());

describe("AiFillPanel", () => {
  it("is not there at all when the admin has it switched off", () => {
    renderPanel({ enabled: false });
    expect(screen.queryByRole("button", { name: a.ask })).not.toBeInTheDocument();
  });

  it("opens on the button, and asks for a note before it sends anything", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: a.ask }));
    await userEvent.click(screen.getByRole("button", { name: a.fill }));
    expect(await screen.findByText(a.errors.empty)).toBeInTheDocument();
    expect(suggestFields).not.toHaveBeenCalled();
  });

  it("sends the note and hands the checked suggestion to the form", async () => {
    const suggestion = { categoryIds: ["cat-1"], outcome: "DECIDE_LATER", check: [] };
    suggestFields.mockResolvedValue({ ok: true, data: { suggestionId: "s-1", suggestion } });
    const { onApply } = renderPanel({ defaultOpen: true });

    await userEvent.type(screen.getByLabelText(a.note), "Sunday aayega");
    await userEvent.click(screen.getByRole("button", { name: a.fill }));

    await waitFor(() =>
      expect(suggestFields).toHaveBeenCalledWith({
        screen: "visit",
        customerId: "cust-1",
        text: "Sunday aayega",
      }),
    );
    expect(onApply).toHaveBeenCalledWith(suggestion, "s-1");
    // The panel folds away; the button is back for a second go.
    expect(await screen.findByRole("button", { name: a.ask })).toBeInTheDocument();
  });

  it("shows the server's reason when the AI could not help, and keeps the note", async () => {
    suggestFields.mockResolvedValue({
      ok: false,
      code: "RULE",
      message: "ai.errors.limit",
      values: { limit: 100 },
    });
    const { onApply } = renderPanel({ defaultOpen: true });

    await userEvent.type(screen.getByLabelText(a.note), "note");
    await userEvent.click(screen.getByRole("button", { name: a.fill }));

    expect(await screen.findByText(a.errors.limit.replace("{limit}", "100"))).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByLabelText(a.note)).toHaveValue("note");
  });
});
