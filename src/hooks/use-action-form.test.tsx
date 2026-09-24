import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { useActionForm } from "@/hooks/use-action-form";
import type { ActionResult } from "@/lib/errors";

const schema = z.object({
  name: z.string().trim().min(1, "name.required"),
  area: z.string().max(5, "area.tooLong"),
});

function Form({ action }: { action: (input: unknown) => Promise<ActionResult<null>> }) {
  const { onSubmit, errors, formError } = useActionForm(action, schema);
  return (
    <form onSubmit={onSubmit} noValidate>
      <label>
        Name
        <input name="name" />
      </label>
      <label>
        Area
        <input name="area" />
      </label>
      <p>{errors["name"] ?? errors["area"] ?? formError}</p>
      <button type="submit">Save</button>
    </form>
  );
}

// Found in the cross-role audit: with <form action>, React 19 emptied every field after
// any submit, so a refused form had to be typed again from scratch.
describe("useActionForm", () => {
  it("keeps what was typed when the form is refused on the phone", async () => {
    const action = vi.fn();
    render(<Form action={action} />);

    await userEvent.type(screen.getByLabelText("Area"), "Satellite");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("name.required")).toBeInTheDocument();
    expect(screen.getByLabelText("Area")).toHaveValue("Satellite");
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the server refuses it", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      code: "RULE",
      message: "name.taken",
      field: "name",
    });
    render(<Form action={action} />);

    await userEvent.type(screen.getByLabelText("Name"), "Asha");
    await userEvent.type(screen.getByLabelText("Area"), "Vadaj");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("name.taken")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Asha");
    expect(screen.getByLabelText("Area")).toHaveValue("Vadaj");
  });

  it("empties the form after a successful save, ready for the next entry", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, data: null });
    render(<Form action={action} />);

    await userEvent.type(screen.getByLabelText("Name"), "Asha");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
    expect(action).toHaveBeenCalledWith({ name: "Asha", area: "" });
  });
});
