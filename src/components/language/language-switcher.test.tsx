import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import hi from "../../../messages/hi.json";
import { LanguageSwitcher } from "@/components/language/language-switcher";

const setLanguage = vi.fn(async (input: { language: string }) => ({
  ok: true as const,
  data: { language: input.language },
}));
vi.mock("@/lib/actions/language", () => ({
  setLanguage: (input: { language: string }) => setLanguage(input),
}));

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ toast }));

function renderIn(locale: "en" | "hi", messages: object) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Kolkata">
      <LanguageSwitcher />
    </NextIntlClientProvider>,
  );
}

describe("LanguageSwitcher", () => {
  it("names itself in the language on screen", () => {
    renderIn("hi", hi);
    expect(screen.getByRole("button", { name: hi.language.switch })).toBeInTheDocument();
  });

  it("lists every language in its own script, whatever the screen language is", async () => {
    renderIn("hi", hi);
    await userEvent.click(screen.getByRole("button", { name: hi.language.switch }));

    const items = await screen.findAllByRole("menuitemradio");
    // Someone stranded in a script they cannot read must still find their own.
    expect(items.map((item) => item.textContent)).toEqual(["English", "हिन्दी", "ગુજરાતી"]);
  });

  it("marks the language already in use", async () => {
    renderIn("hi", hi);
    await userEvent.click(screen.getByRole("button", { name: hi.language.switch }));

    const current = await screen.findByRole("menuitemradio", { name: "हिन्दी" });
    expect(current).toHaveAttribute("aria-checked", "true");
  });

  it("saves the language that was picked", async () => {
    renderIn("en", en);
    await userEvent.click(screen.getByRole("button", { name: en.language.switch }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "ગુજરાતી" }));

    expect(setLanguage).toHaveBeenCalledWith({ language: "gu" });
  });

  it("does nothing when the language on screen is picked again", async () => {
    renderIn("en", en);
    await userEvent.click(screen.getByRole("button", { name: en.language.switch }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "English" }));

    expect(setLanguage).not.toHaveBeenCalled();
  });

  it("says nothing on success: the screen changing language is the confirmation", async () => {
    renderIn("en", en);
    await userEvent.click(screen.getByRole("button", { name: en.language.switch }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "हिन्दी" }));

    expect(toast.error).not.toHaveBeenCalled();
  });
});
