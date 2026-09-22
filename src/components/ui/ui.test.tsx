import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OptionList } from "@/components/ui/option-list";
import { TextInput } from "@/components/ui/text-input";

const slots = [
  { value: "MORNING", label: "Morning" },
  { value: "EVENING", label: "Evening" },
];

function SingleChips() {
  const [value, setValue] = useState("MORNING");
  return (
    <ChoiceChips
      type="single"
      label="Slot"
      value={value}
      onValueChange={setValue}
      options={slots}
    />
  );
}

function MultiChips() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <ChoiceChips
      type="multiple"
      label="Slot"
      value={value}
      onValueChange={setValue}
      options={slots}
    />
  );
}

describe("Button", () => {
  it("does not fire clicks when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save sale
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save sale" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("TextInput", () => {
  it("links the label and marks the error for screen readers", () => {
    render(<TextInput label="Bill number" error="Already used" />);
    const input = screen.getByLabelText("Bill number");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Already used");
    expect(screen.getByRole("alert")).toHaveTextContent("Already used");
  });
});

describe("ChoiceChips", () => {
  it("single: switches the selected chip and never clears it", async () => {
    render(<SingleChips />);
    const morning = screen.getByRole("radio", { name: "Morning" });
    const evening = screen.getByRole("radio", { name: "Evening" });
    expect(morning).toHaveAttribute("data-state", "on");

    await userEvent.click(evening);
    expect(evening).toHaveAttribute("data-state", "on");
    expect(morning).toHaveAttribute("data-state", "off");

    await userEvent.click(evening);
    expect(evening).toHaveAttribute("data-state", "on");
  });

  it("multiple: several chips can be on at once", async () => {
    render(<MultiChips />);
    await userEvent.click(screen.getByRole("button", { name: "Morning" }));
    await userEvent.click(screen.getByRole("button", { name: "Evening" }));
    expect(screen.getByRole("button", { name: "Morning" })).toHaveAttribute("data-state", "on");
    expect(screen.getByRole("button", { name: "Evening" })).toHaveAttribute("data-state", "on");
  });
});

describe("OptionList", () => {
  it("selects an option by click and reports the value", async () => {
    const onValueChange = vi.fn();
    render(
      <OptionList
        label="Outcome"
        value="A"
        onValueChange={onValueChange}
        options={[
          { value: "A", label: "Purchased" },
          { value: "B", label: "Will decide later", description: "Set a follow-up" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "Purchased" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /Will decide later/ }));
    expect(onValueChange).toHaveBeenCalledWith("B");
  });
});

describe("ConfirmDialog", () => {
  function renderDialog(onConfirm: () => void) {
    render(
      <ConfirmDialog
        trigger={<Button>Open</Button>}
        title="Cancel this sale?"
        confirmLabel="Cancel sale"
        cancelLabel="Keep sale"
        onConfirm={onConfirm}
      />,
    );
  }

  it("calls onConfirm only when confirm is pressed", async () => {
    const onConfirm = vi.fn();
    renderDialog(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep sale" }));
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel sale" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("closes on Escape without confirming", async () => {
    const onConfirm = vi.fn();
    renderDialog(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
