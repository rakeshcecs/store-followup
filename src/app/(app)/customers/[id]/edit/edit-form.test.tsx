import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../../messages/en.json";

const push = vi.hoisted(() => vi.fn());
const updateCustomerAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/actions/customer", () => ({ updateCustomer: updateCustomerAction }));

const { EditCustomerForm } = await import("@/app/(app)/customers/[id]/edit/edit-form");

const customer = {
  id: "cust-1",
  name: "Asha Patel",
  mobile: "9825011223",
  altMobile: "",
  area: "Satellite",
  city: "Ahmedabad",
  address: "",
  occasion: "Son's wedding",
  occasionDate: "2026-12-12",
  departmentId: "dep-1",
};

function renderForm(canChangeMobile: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EditCustomerForm
        customer={customer}
        departments={[{ id: "dep-1", name: "Men's Wear" }]}
        canChangeMobile={canChangeMobile}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  updateCustomerAction.mockReset();
});

describe("EditCustomerForm", () => {
  it("gives a salesperson no mobile box, and sends no mobile", async () => {
    updateCustomerAction.mockResolvedValue({ ok: true, data: { id: "cust-1" } });
    renderForm(false);

    expect(screen.queryByLabelText(en.customers.fields.mobile)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en.customers.edit.save }));

    await waitFor(() => expect(updateCustomerAction).toHaveBeenCalled());
    expect(updateCustomerAction.mock.calls[0]?.[0]).not.toHaveProperty("mobile");
    expect(push).toHaveBeenCalledWith("/customers/cust-1");
  });

  it("gives a manager the mobile box, filled in", () => {
    renderForm(true);

    expect(screen.getByLabelText(en.customers.fields.mobile)).toHaveValue("9825011223");
  });

  it("starts from the saved details and sends what was changed, clearing emptied boxes", async () => {
    updateCustomerAction.mockResolvedValue({ ok: true, data: { id: "cust-1" } });
    renderForm(false);

    const area = screen.getByLabelText(en.customers.fields.area);
    expect(area).toHaveValue("Satellite");
    await userEvent.clear(area);
    await userEvent.clear(screen.getByLabelText(en.customers.fields.city));
    await userEvent.type(screen.getByLabelText(en.customers.fields.city), "Vadodara");
    await userEvent.click(screen.getByRole("button", { name: en.customers.edit.save }));

    await waitFor(() =>
      expect(updateCustomerAction).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "cust-1",
          name: "Asha Patel",
          area: undefined, // emptied: the action stores null
          city: "Vadodara",
          occasionDate: "2026-12-12",
          departmentId: "dep-1",
        }),
      ),
    );
  });

  it("shows the server's refusal on the mobile box, with the owner's name", async () => {
    updateCustomerAction.mockResolvedValue({
      ok: false,
      code: "CONFLICT",
      message: "customers.errors.mobileTaken",
      field: "mobile",
      values: { name: "Ravi Shah" },
    });
    renderForm(true);

    await userEvent.click(screen.getByRole("button", { name: en.customers.edit.save }));

    expect(
      await screen.findByText(en.customers.errors.mobileTaken.replace("{name}", "Ravi Shah")),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
