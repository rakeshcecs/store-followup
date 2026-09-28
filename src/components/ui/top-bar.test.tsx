import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordScreen, resetScreens } from "@/lib/nav-history";

const push = vi.hoisted(() => vi.fn());
const back = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back }) }));

const { TopBar } = await import("@/components/ui/top-bar");

beforeEach(() => {
  push.mockReset();
  back.mockReset();
  resetScreens();
});

describe("TopBar back arrow", () => {
  it("returns to the screen this one was opened from, back through history", async () => {
    recordScreen("/follow-ups?tab=all");
    recordScreen("/customers/c1");
    render(<TopBar title="Customer" backLabel="Back" backHref="/customers" />);

    await userEvent.click(screen.getByRole("link", { name: "Back" }));

    // History, so the phone's own Back afterwards does not reopen the profile.
    expect(back).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to the address when history no longer matches the trail", async () => {
    recordScreen("/follow-ups");
    recordScreen("/follow-ups?tab=all"); // a filter: the browser may hold two entries
    recordScreen("/customers/c1");
    recordScreen("/customers/c1/edit");
    recordScreen("/customers/c1"); // saved: a push that the trail reads as going back
    render(<TopBar title="Customer" backLabel="Back" backHref="/customers" />);

    await userEvent.click(screen.getByRole("link", { name: "Back" }));

    expect(push).toHaveBeenCalledWith("/follow-ups?tab=all");
  });

  it("falls back to its own link when the screen was opened cold", () => {
    recordScreen("/customers/c1");
    render(<TopBar title="Customer" backLabel="Back" backHref="/customers" />);

    // Nothing intercepted: the plain link does the work, and works before JavaScript.
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/customers");
  });

  it("uses the trail over browser history when no backHref is given", async () => {
    recordScreen("/today");
    recordScreen("/profile");
    recordScreen("/profile/pin");
    recordScreen("/profile"); // saved: the PIN form's entry is still behind this one
    render(<TopBar title="Profile" backLabel="Back" />);

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(push).toHaveBeenCalledWith("/today");
    expect(back).not.toHaveBeenCalled();
  });
});
