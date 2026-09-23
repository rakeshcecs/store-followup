import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const createItemAction = vi.hoisted(() => vi.fn());
const renameItemAction = vi.hoisted(() => vi.fn());
const setItemActiveAction = vi.hoisted(() => vi.fn());
const deleteItemAction = vi.hoisted(() => vi.fn());
const reorderItemsAction = vi.hoisted(() => vi.fn());

vi.mock("@/app/(admin)/settings/master-lists/actions", () => ({
  createItem: createItemAction,
  renameItem: renameItemAction,
  setItemActive: setItemActiveAction,
  deleteItem: deleteItemAction,
  reorderItems: reorderItemsAction,
}));

const { MasterList } = await import("@/app/(admin)/settings/master-lists/master-list");

const items = [
  {
    id: "c1",
    nameEn: "Sherwani",
    nameHi: "शेरवानी",
    nameGu: "શેરવાની",
    active: true,
    branchId: null,
    usageCount: 0,
  },
  {
    id: "c2",
    nameEn: "Saree",
    nameHi: "साड़ी",
    nameGu: "સાડી",
    active: true,
    branchId: null,
    usageCount: 3,
  },
];

function list(rows: typeof items, locale: "en" | "hi" | "gu" = "en") {
  const messages = { en, hi: en, gu: en }[locale];
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <MasterList kind="category" items={rows} branches={[{ id: "b1", name: "Main" }]} />
    </NextIntlClientProvider>
  );
}

function renderList(locale: "en" | "hi" | "gu" = "en") {
  return render(list(items, locale));
}

const rowFor = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

beforeEach(() => {
  createItemAction.mockReset();
  renameItemAction.mockReset();
  setItemActiveAction.mockReset();
  deleteItemAction.mockReset();
  reorderItemsAction.mockReset();
});

describe("MasterList", () => {
  it("asks for all three languages before it calls the server", async () => {
    renderList();

    await userEvent.type(screen.getAllByLabelText(en.masterLists.fields.nameEn)[0]!, "Lehenga");
    await userEvent.click(screen.getAllByRole("button", { name: en.masterLists.add })[0]!);

    expect(await screen.findByText(en.masterLists.errors.nameHiRequired)).toBeInTheDocument();
    expect(screen.getByText(en.masterLists.errors.nameGuRequired)).toBeInTheDocument();
    expect(createItemAction).not.toHaveBeenCalled();
  });

  it("sends all three names and the branch choice", async () => {
    createItemAction.mockResolvedValue({ ok: true, data: { id: "c3" } });
    renderList();

    await userEvent.type(screen.getAllByLabelText(en.masterLists.fields.nameEn)[0]!, "Lehenga");
    await userEvent.type(screen.getAllByLabelText(en.masterLists.fields.nameHi)[0]!, "लहंगा");
    await userEvent.type(screen.getAllByLabelText(en.masterLists.fields.nameGu)[0]!, "લહેંગા");
    await userEvent.click(screen.getAllByRole("button", { name: en.masterLists.add })[0]!);

    await waitFor(() =>
      expect(createItemAction).toHaveBeenCalledWith({
        kind: "category",
        nameEn: "Lehenga",
        nameHi: "लहंगा",
        nameGu: "લહેંગા",
        branchId: "all",
      }),
    );
  });

  it("offers Delete only for an item nothing uses", async () => {
    renderList();

    expect(
      within(rowFor("Sherwani")).getByRole("button", { name: en.masterLists.delete }),
    ).toBeInTheDocument();
    expect(
      within(rowFor("Saree")).queryByRole("button", { name: en.masterLists.delete }),
    ).not.toBeInTheDocument();
    // …and says why, instead of a dead button.
    expect(within(rowFor("Saree")).getByText(/make it inactive instead/)).toBeInTheDocument();
  });

  // A real drag is not testable here: dnd-kit needs layout boxes and jsdom reports every
  // element as 0x0, so any "drag" would pass whatever the code did. The part that can be
  // wrong — which ids are sent, and in what order — is tests/unit/reorder.test.ts.

  it("adopts a row the server changed, not only a row it added or moved", () => {
    // Deactivating changes no id and no position. The screen used to compare ids alone,
    // so it kept showing the row as active until the page was reloaded.
    const { rerender } = render(list(items));
    expect(within(rowFor("Sherwani")).queryByText(en.masterLists.inactive)).toBeNull();

    const deactivated = items.map((item) => (item.id === "c1" ? { ...item, active: false } : item));
    rerender(list(deactivated));

    const row = rowFor("Sherwani");
    expect(within(row).getByText(en.masterLists.inactive)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: en.masterLists.activate })).toBeInTheDocument();
  });

  it("shows each item in the reading language", () => {
    renderList("gu");
    expect(screen.getByText("શેરવાની")).toBeInTheDocument();
    expect(screen.queryByText("Sherwani")).not.toBeInTheDocument();
  });
});
