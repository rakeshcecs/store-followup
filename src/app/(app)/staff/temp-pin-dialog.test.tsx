import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import { TempPinDialog } from "@/app/(app)/staff/temp-pin-dialog";

describe("TempPinDialog", () => {
  it("shows the PIN with one Done button, which closes it", async () => {
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TempPinDialog name="Asha" pin="1761" onClose={onClose} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("1761")).toBeInTheDocument();
    // Nothing to back out of, so no second button that does the same thing.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(en.staff.tempPin.done);

    await userEvent.click(buttons[0]!);
    expect(onClose).toHaveBeenCalled();
  });
});
