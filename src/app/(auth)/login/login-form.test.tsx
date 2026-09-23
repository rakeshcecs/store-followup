import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";

const replace = vi.hoisted(() => vi.fn());
const loginAction = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => new URLSearchParams());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/actions/auth", () => ({ login: loginAction }));

const { LoginForm } = await import("@/app/(auth)/login/login-form");

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <LoginForm />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  replace.mockReset();
  loginAction.mockReset();
  searchParams.delete("next");
});

describe("LoginForm", () => {
  it("hides the PIN and asks the phone for a number pad", () => {
    renderForm();
    const pin = screen.getByLabelText(en.auth.fields.pin);

    expect(pin).toHaveAttribute("type", "password");
    expect(pin).toHaveAttribute("inputMode", "numeric");
    expect(pin).toHaveAttribute("maxLength", "4");
  });

  it("shows both field errors at once, without calling the server", async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText(en.auth.fields.mobile), "12345");
    await userEvent.type(screen.getByLabelText(en.auth.fields.pin), "12");
    await userEvent.click(screen.getByRole("button", { name: en.auth.logIn }));

    expect(await screen.findByText(en.auth.errors.mobileInvalid)).toBeInTheDocument();
    expect(screen.getByText(en.auth.errors.pinDigits)).toBeInTheDocument();
    expect(loginAction).not.toHaveBeenCalled();
  });

  it("sends the mobile, the PIN and the chosen language", async () => {
    loginAction.mockResolvedValue({ ok: true, data: { role: "MANAGER", mustChangePin: false } });
    renderForm();

    await userEvent.type(screen.getByLabelText(en.auth.fields.mobile), "98765 43210");
    await userEvent.type(screen.getByLabelText(en.auth.fields.pin), "4839");
    await userEvent.click(screen.getByRole("button", { name: en.auth.logIn }));

    await waitFor(() =>
      expect(loginAction).toHaveBeenCalledWith({
        mobile: "9876543210", // normalised before it leaves the browser
        pin: "4839",
        language: "en",
      }),
    );
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("goes to the PIN screen first when the PIN must be changed", async () => {
    loginAction.mockResolvedValue({ ok: true, data: { role: "ADMIN", mustChangePin: true } });
    renderForm();

    await userEvent.type(screen.getByLabelText(en.auth.fields.mobile), "9876543210");
    await userEvent.type(screen.getByLabelText(en.auth.fields.pin), "4839");
    await userEvent.click(screen.getByRole("button", { name: en.auth.logIn }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/set-pin"));
  });

  it("returns to the screen they were sent away from", async () => {
    searchParams.set("next", "/branches");
    loginAction.mockResolvedValue({ ok: true, data: { role: "ADMIN", mustChangePin: false } });
    renderForm();

    await userEvent.type(screen.getByLabelText(en.auth.fields.mobile), "9876543210");
    await userEvent.type(screen.getByLabelText(en.auth.fields.pin), "4839");
    await userEvent.click(screen.getByRole("button", { name: en.auth.logIn }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/branches"));
  });

  it("shows the server's message when the PIN is wrong", async () => {
    loginAction.mockResolvedValue({
      ok: false,
      code: "RULE",
      message: "auth.errors.badCredentials",
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(en.auth.fields.mobile), "9876543210");
    await userEvent.type(screen.getByLabelText(en.auth.fields.pin), "0007");
    await userEvent.click(screen.getByRole("button", { name: en.auth.logIn }));

    expect(await screen.findByText(en.auth.errors.badCredentials)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
