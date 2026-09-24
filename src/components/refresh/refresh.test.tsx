import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import { AutoRefresh, REFRESH_EVERY_MS } from "@/components/refresh/auto-refresh";
import { PULL_THRESHOLD, PullToRefresh } from "@/components/refresh/pull-to-refresh";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

let visibility: DocumentVisibilityState = "visible";
function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  router.refresh.mockClear();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// M11: "Counts refresh when the screen opens and every 60 seconds while it is open."
describe("AutoRefresh", () => {
  it("refreshes every 60 seconds while the screen is open", () => {
    vi.useFakeTimers();
    render(<AutoRefresh />);

    vi.advanceTimersByTime(REFRESH_EVERY_MS - 1);
    expect(router.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REFRESH_EVERY_MS);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("stops while the phone is away, and refreshes at once on coming back", () => {
    vi.useFakeTimers();
    render(<AutoRefresh />);

    act(() => setVisibility("hidden"));
    vi.advanceTimersByTime(REFRESH_EVERY_MS * 5);
    expect(router.refresh).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REFRESH_EVERY_MS);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("stops when the screen is left", () => {
    vi.useFakeTimers();
    const { unmount } = render(<AutoRefresh />);
    unmount();
    vi.advanceTimersByTime(REFRESH_EVERY_MS * 3);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("PullToRefresh", () => {
  function renderInMain() {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
        <main data-testid="scroller">
          <PullToRefresh />
          <p>List</p>
        </main>
      </NextIntlClientProvider>,
    );
    return screen.getByTestId("scroller");
  }

  const pull = (scroller: HTMLElement, distance: number) => {
    fireEvent.touchStart(scroller, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(scroller, { touches: [{ clientY: 100 + distance }] });
  };

  it("refreshes after a pull past the threshold from the top", () => {
    const scroller = renderInMain();
    pull(scroller, PULL_THRESHOLD + 10);
    expect(screen.getByRole("status")).toHaveTextContent(en.refresh.release);
    fireEvent.touchEnd(scroller);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a short pull", () => {
    const scroller = renderInMain();
    pull(scroller, PULL_THRESHOLD - 10);
    expect(screen.getByRole("status")).toHaveTextContent(en.refresh.pull);
    fireEvent.touchEnd(scroller);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("leaves a normal scroll alone when the list is not at the top", () => {
    const scroller = renderInMain();
    scroller.scrollTop = 200;
    pull(scroller, PULL_THRESHOLD * 2);
    fireEvent.touchEnd(scroller);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
