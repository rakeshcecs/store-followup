import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import { FollowUpFilters, SEARCH_DELAY_MS } from "@/app/(app)/follow-ups/follow-up-filters";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const nav = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/follow-ups",
  useSearchParams: () => new URLSearchParams(nav.query),
}));

function renderFilters() {
  // The component builds the next address from the address bar, like the browser does.
  window.history.replaceState(null, "", `/follow-ups${nav.query ? `?${nav.query}` : ""}`);
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
      <FollowUpFilters staff={null} />
    </NextIntlClientProvider>,
  );
  return screen.getByLabelText(en.followUps.list.filters.search);
}

beforeEach(() => {
  router.replace.mockClear();
  nav.query = "";
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

// Found by the client: typing a name and waiting did nothing, because the search only
// ran on Enter or on leaving the box.
describe("FollowUpFilters search", () => {
  it("searches by itself after a pause in typing", () => {
    const box = renderFilters();
    fireEvent.change(box, { target: { value: "Rekha" } });

    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS - 1));
    expect(router.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(router.replace).toHaveBeenCalledWith("/follow-ups?q=Rekha");
  });

  it("sends one search for a burst of typing, not one per letter", () => {
    const box = renderFilters();
    for (const value of ["R", "Re", "Rek", "Rekha"]) {
      fireEvent.change(box, { target: { value } });
      act(() => vi.advanceTimersByTime(100));
    }
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/follow-ups?q=Rekha");
  });

  it("searches at once on Enter, keeps the tab, and starts again from the first page", () => {
    nav.query = "tab=overdue&limit=100";
    const box = renderFilters();
    fireEvent.change(box, { target: { value: "98765 43210" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(router.replace).toHaveBeenCalledWith("/follow-ups?tab=overdue&q=98765+43210");

    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
    expect(router.replace).toHaveBeenCalledTimes(1); // the pending timer was dropped
  });

  it("does not search again for the text already searched", () => {
    nav.query = "q=Rekha";
    const box = renderFilters();
    fireEvent.change(box, { target: { value: "Rekha " } });
    fireEvent.blur(box);
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(router.replace).not.toHaveBeenCalled();
  });
});
