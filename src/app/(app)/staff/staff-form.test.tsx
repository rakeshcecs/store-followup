import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";

const push = vi.hoisted(() => vi.fn());
const createStaffAction = vi.hoisted(() => vi.fn());
const updateStaffAction = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/(app)/staff/actions", () => ({
  createStaff: createStaffAction,
  updateStaff: updateStaffAction,
}));

const { StaffForm } = await import("@/app/(app)/staff/staff-form");

const branches = [{ id: "branch-1", name: "Main" }];
const departments = [{ id: "dep-1", name: "Sales" }];

function renderForm(staff?: Parameters<typeof StaffForm>[0]["staff"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffForm branches={branches} departments={departments} staff={staff} />
    </NextIntlClientProvider>,
  );
}

async function fillValid() {
  await userEvent.type(screen.getByLabelText(en.staff.fields.name), "Asha Patel");
  await userEvent.type(screen.getByLabelText(en.staff.fields.mobile), "98765 43210");
}

beforeEach(() => {
  push.mockReset();
  createStaffAction.mockReset();
  updateStaffAction.mockReset();
});

describe("StaffForm", () => {
  it("shows every wrong field at once, without calling the server", async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(en.staff.fields.name), "A");
    await userEvent.type(screen.getByLabelText(en.staff.fields.mobile), "12345");
    await userEvent.click(screen.getByRole("button", { name: en.staff.save }));

    expect(await screen.findByText(en.staff.errors.nameRequired)).toBeInTheDocument();
    expect(screen.getByText(en.auth.errors.mobileInvalid)).toBeInTheDocument();
    expect(createStaffAction).not.toHaveBeenCalled();
  });

  it("normalises the mobile before sending it", async () => {
    createStaffAction.mockResolvedValue({
      ok: true,
      data: { id: "u1", fullName: "Asha Patel", tempPin: "4839" },
    });
    renderForm();
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: en.staff.save }));

    await waitFor(() =>
      expect(createStaffAction).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: "Asha Patel", mobile: "9876543210" }),
      ),
    );
  });

  it("shows the temporary PIN once, and only leaves the screen when it is closed", async () => {
    createStaffAction.mockResolvedValue({
      ok: true,
      data: { id: "u1", fullName: "Asha Patel", tempPin: "4839" },
    });
    renderForm();
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: en.staff.save }));

    expect(await screen.findByText("4839")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled(); // the admin must read it first

    await userEvent.click(screen.getAllByRole("button", { name: en.staff.tempPin.done })[0]!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff"));
  });

  it("names the person already using a mobile number", async () => {
    createStaffAction.mockResolvedValue({
      ok: false,
      code: "CONFLICT",
      message: "staff.errors.mobileTaken",
      field: "mobile",
      values: { name: "Ravi Shah" },
    });
    renderForm();
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: en.staff.save }));

    expect(
      await screen.findByText("This mobile number is already used by Ravi Shah."),
    ).toBeInTheDocument();
  });

  it("edits without ever showing a PIN", async () => {
    updateStaffAction.mockResolvedValue({ ok: true, data: { id: "u1", fullName: "Asha Patel" } });
    renderForm({
      id: "u1",
      fullName: "Asha Patel",
      mobile: "9876543210",
      role: "SALESPERSON",
      homeBranchId: "branch-1",
      departmentId: null,
      joinedOn: null,
    });

    await userEvent.click(screen.getByRole("button", { name: en.staff.save }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff"));
    expect(screen.queryByText(en.staff.tempPin.title)).not.toBeInTheDocument();
  });
});
