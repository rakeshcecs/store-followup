import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

const markAnswerWrong = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/ai", () => ({ markAnswerWrong }));

const { AskBox } = await import("@/components/ai/ask-box");

const a = en.ask;

function renderBox(suggestions: string[] = []) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AskBox suggestions={suggestions} />
    </NextIntlClientProvider>,
  );
}

// The answer as /api/ai/ask streams it: one JSON event per line, cut anywhere.
function streamed(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 11) controller.enqueue(bytes.slice(i, i + 11));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

const fetchMock = vi.fn();
beforeEach(() => {
  markAnswerWrong.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("AskBox", () => {
  it("asks for a question before sending anything", async () => {
    renderBox();
    await userEvent.click(screen.getByRole("button", { name: a.send }));
    expect(await screen.findByText(a.errors.empty)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams the answer, shows the table with profile links, and can be marked wrong", async () => {
    fetchMock.mockResolvedValue(
      streamed([
        { type: "tool", name: "find_followups" },
        {
          type: "tables",
          tables: [
            {
              key: "followUps",
              title: "Follow-ups",
              note: "Showing 50 of 132",
              columns: [
                { label: "Customer", numeric: false },
                { label: "Due", numeric: false },
              ],
              rows: [{ cells: ["Ramesh Patel", "25 Sep 2026"], href: "/customers/c-1" }],
            },
          ],
        },
        { type: "text", delta: "You have 132 follow-ups today, " },
        { type: "text", delta: "showing 50 of 132." },
        { type: "done", questionId: "q-1" },
      ]),
    );
    markAnswerWrong.mockResolvedValue({ ok: true, data: undefined });
    renderBox();

    await userEvent.type(screen.getByLabelText(a.label), "who today?");
    await userEvent.click(screen.getByRole("button", { name: a.send }));

    expect(
      await screen.findByText("You have 132 follow-ups today, showing 50 of 132."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/ask",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ question: "who today?" }) }),
    );
    expect(screen.getByRole("link", { name: "Ramesh Patel" })).toHaveAttribute(
      "href",
      "/customers/c-1",
    );
    expect(screen.getByText("Showing 50 of 132")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: a.wrong }));
    expect(await screen.findByText(a.wrongDone)).toBeInTheDocument();
    expect(markAnswerWrong).toHaveBeenCalledWith({ questionId: "q-1" });
  });

  it("a suggested question is asked in one tap, and the suggestions then go away", async () => {
    fetchMock.mockResolvedValue(
      streamed([
        { type: "text", delta: "No customers found." },
        { type: "done", questionId: "q-2" },
      ]),
    );
    renderBox([a.suggestions.store.today]);
    await userEvent.click(screen.getByRole("button", { name: a.suggestions.store.today }));
    expect(await screen.findByText("No customers found.")).toBeInTheDocument();
    expect(screen.queryByText(a.suggested)).not.toBeInTheDocument();
    expect(screen.getByLabelText(a.label)).toHaveValue(a.suggestions.store.today);
  });

  it("text written before a search is replaced by the real answer", async () => {
    fetchMock.mockResolvedValue(
      streamed([
        { type: "text", delta: "Let me check…" },
        { type: "reset" },
        { type: "text", delta: "3 sales." },
        { type: "done", questionId: "q-3" },
      ]),
    );
    renderBox();
    await userEvent.type(screen.getByLabelText(a.label), "sales?");
    await userEvent.click(screen.getByRole("button", { name: a.send }));
    expect(await screen.findByText("3 sales.")).toBeInTheDocument();
    expect(screen.queryByText(/Let me check/)).not.toBeInTheDocument();
  });

  it("shows the server's reason: switched off, the daily limit, or a failed answer", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "ai.errors.limit", values: { limit: 100 } }, { status: 403 }),
    );
    renderBox();
    await userEvent.type(screen.getByLabelText(a.label), "q");
    await userEvent.click(screen.getByRole("button", { name: a.send }));
    expect(
      await screen.findByText(en.ai.errors.limit.replace("{limit}", "100")),
    ).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(streamed([{ type: "error", message: "ask.errors.failed" }]));
    await userEvent.click(screen.getByRole("button", { name: a.send }));
    expect(await screen.findByText(a.errors.failed)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: a.wrong })).toBeNull());
  });
});
