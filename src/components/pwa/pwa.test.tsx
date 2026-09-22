import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import { InstallHelp } from "@/components/pwa/install-help";
import { OnlineStatus } from "@/components/pwa/online-status";

function withIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function mockBrowser({
  standalone = false,
  userAgent = "Mozilla/5.0 (Windows NT 10.0) Chrome/140",
}) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: standalone, addEventListener: vi.fn() }),
  );
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OnlineStatus", () => {
  it("switches between Online and Offline with the browser events", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    withIntl(<OnlineStatus />);
    expect(screen.getByRole("status")).toHaveTextContent("Online");

    onLine.mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByRole("status")).toHaveTextContent("Offline");

    onLine.mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.getByRole("status")).toHaveTextContent("Online");
  });
});

describe("InstallHelp", () => {
  it("shows nothing when the app is already installed", () => {
    mockBrowser({ standalone: true });
    const { container } = withIntl(<InstallHelp />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the Share hint on iPhone", () => {
    mockBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari" });
    withIntl(<InstallHelp />);
    expect(screen.getByText(en.pwa.iosHint)).toBeInTheDocument();
  });

  it("shows nothing on desktop until the browser offers install", () => {
    mockBrowser({});
    const { container } = withIntl(<InstallHelp />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an Install button after beforeinstallprompt and opens the prompt", async () => {
    mockBrowser({});
    withIntl(<InstallHelp />);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: en.pwa.install }));
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: en.pwa.install })).not.toBeInTheDocument();
  });
});
