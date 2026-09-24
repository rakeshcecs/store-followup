import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const push = vi.hoisted(() => vi.fn());
const createCustomerAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/actions/customer", () => ({ createCustomer: createCustomerAction }));

const { CustomerForm } = await import("@/app/(app)/customers/new/customer-form");

const departments = [{ id: "dep-1", name: "Men's Wear" }];
const staff = [{ id: "user-1", name: "Amit" }];

function renderForm(mobile = "9825011223") {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CustomerForm
        mobile={mobile}
        departments={departments}
        staff={staff}
        currentUserId="user-1"
        defaultCity="Ahmedabad"
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  createCustomerAction.mockReset();
});

describe("CustomerForm", () => {
  it("refuses an empty name without calling the server", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: en.customers.save }));

    expect(await screen.findByText(en.customers.errors.nameRequired)).toBeInTheDocument();
    expect(createCustomerAction).not.toHaveBeenCalled();
  });

  it("carries the searched number in, and sends only what was filled in", async () => {
    createCustomerAction.mockResolvedValue({ ok: true, data: { id: "cust-1" } });
    renderForm();

    expect(screen.getByLabelText(en.customers.fields.mobile)).toHaveValue("9825011223");
    await userEvent.type(screen.getByLabelText(en.customers.fields.name), "Asha Patel");
    await userEvent.click(screen.getByRole("button", { name: en.customers.save }));

    await waitFor(() =>
      expect(createCustomerAction).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Asha Patel",
          mobile: "9825011223",
          assignedToId: "user-1",
          consentGiven: true, // ticked by default (M05.08)
          departmentId: undefined,
        }),
      ),
    );
  });

  it("strips anything that is not a digit as the number is typed (M05.02)", async () => {
    renderForm("");
    const mobile = screen.getByLabelText(en.customers.fields.mobile);

    await userEvent.type(mobile, "98 765-43210");

    expect(mobile).toHaveValue("9876543210");
  });

  it("sends no consent when the box is unticked", async () => {
    createCustomerAction.mockResolvedValue({ ok: true, data: { id: "cust-1" } });
    renderForm();

    await userEvent.type(screen.getByLabelText(en.customers.fields.name), "Asha Patel");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: en.customers.save }));

    await waitFor(() =>
      expect(createCustomerAction).toHaveBeenCalledWith(
        expect.objectContaining({ consentGiven: false }),
      ),
    );
  });

  it("keeps the extra details out of the way until they are asked for", async () => {
    renderForm();

    expect(screen.getByLabelText(en.customers.fields.area)).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: en.customers.moreDetails }));

    expect(screen.getByLabelText(en.customers.fields.area)).toBeVisible();
    // The store's own city is already filled in (M05.06).
    expect(screen.getByLabelText(en.customers.fields.city)).toHaveValue("Ahmedabad");
  });

  it("goes to Record visit after saving (M05.10)", async () => {
    createCustomerAction.mockResolvedValue({ ok: true, data: { id: "cust-9" } });
    renderForm();

    await userEvent.type(screen.getByLabelText(en.customers.fields.name), "Asha Patel");
    await userEvent.click(screen.getByRole("button", { name: en.customers.save }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/visits/new?customerId=cust-9"));
  });

  it("never swallows an error about a field it does not show", async () => {
    // An admin looking at every branch at once cannot file a walk-in anywhere, and the
    // action says so on "branchId" — a field this form has no box for. Without a
    // fallback the screen simply did nothing when Save was pressed.
    createCustomerAction.mockResolvedValue({
      ok: false,
      code: "RULE",
      message: "branch.errors.pickOne",
      field: "branchId",
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(en.customers.fields.name), "Asha Patel");
    await userEvent.click(screen.getByRole("button", { name: en.customers.save }));

    expect(await screen.findByText(en.branch.errors.pickOne)).toBeInTheDocument();
  });

  it("hands the customer to someone who works in the branch on screen", async () => {
    createCustomerAction.mockResolvedValue({ ok: true, data: { id: "cust-1" } });
    // An admin looking at another branch is not in that branch's staff list, so
    // defaulting "Handled by" to them would post an id the server rejects.
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CustomerForm
          mobile="9825011223"
          departments={departments}
          staff={[{ id: "other-1", name: "Meera" }]}
          currentUserId="admin-9"
          defaultCity="Surat"
        />
      </NextIntlClientProvider>,
    );

    await userEvent.type(screen.getByLabelText(en.customers.fields.name), "Asha Patel");
    await userEvent.click(screen.getByRole("button", { name: en.customers.save }));

    await waitFor(() =>
      expect(createCustomerAction).toHaveBeenCalledWith(
        expect.objectContaining({ assignedToId: "other-1" }),
      ),
    );
  });

  it("shows the existing customer when the number is already taken (M05.09)", async () => {
    createCustomerAction.mockResolvedValue({
      ok: false,
      code: "CONFLICT",
      message: "customers.errors.mobileTaken",
      field: "mobile",
      values: { name: "Asha Patel" },
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(en.customers.fields.name), "Someone Else");
    await userEvent.click(screen.getByRole("button", { name: en.customers.save }));

    // Not an error to argue with: the search result for that number is that customer.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers?mobile=9825011223"));
  });
});
