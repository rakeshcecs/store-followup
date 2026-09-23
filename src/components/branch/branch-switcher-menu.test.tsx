import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { BranchSwitcherMenu } from "@/components/branch/branch-switcher-menu";

const setCurrentBranch = vi.fn(async (input: { branchId: string }) => ({
  ok: true as const,
  data: { branchId: input.branchId },
}));
vi.mock("@/lib/actions/current-branch", () => ({
  setCurrentBranch: (input: { branchId: string }) => setCurrentBranch(input),
}));

const branches = [
  { id: "a", name: "Main Branch" },
  { id: "b", name: "Second Branch" },
];

function renderMenu(props: Partial<Parameters<typeof BranchSwitcherMenu>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Kolkata">
      <BranchSwitcherMenu branches={branches} current="a" canSeeAll={false} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("BranchSwitcherMenu", () => {
  it("shows the branch the user is looking at", () => {
    renderMenu();
    expect(screen.getByRole("button", { name: messages.branch.switch })).toHaveTextContent(
      "Main Branch",
    );
  });

  it("names 'All branches' for an admin", () => {
    renderMenu({ current: "all", canSeeAll: true });
    expect(screen.getByRole("button", { name: messages.branch.switch })).toHaveTextContent(
      messages.branch.all,
    );
  });

  it("lists every branch the user may switch to", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: messages.branch.switch }));

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Main Branch", "Second Branch"]);
    expect(screen.queryByText(messages.branch.all)).not.toBeInTheDocument();
  });

  it("offers 'All branches' only to a user who may see it", async () => {
    renderMenu({ canSeeAll: true });
    await userEvent.click(screen.getByRole("button", { name: messages.branch.switch }));

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      messages.branch.all,
      "Main Branch",
      "Second Branch",
    ]);
  });

  it("switches to the branch that was picked", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: messages.branch.switch }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Second Branch" }));

    expect(setCurrentBranch).toHaveBeenCalledWith({ branchId: "b" });
  });
});
