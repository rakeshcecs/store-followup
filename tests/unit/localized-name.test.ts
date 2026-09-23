import { describe, expect, it } from "vitest";
import { localizedName, sortByLocalizedName, withLocalizedName } from "@/lib/localized-name";

const saree = { nameEn: "Saree", nameHi: "साड़ी", nameGu: "સાડી" };

describe("localizedName", () => {
  it("picks the name in the reading language", () => {
    expect(localizedName(saree, "en")).toBe("Saree");
    expect(localizedName(saree, "hi")).toBe("साड़ी");
    expect(localizedName(saree, "gu")).toBe("સાડી");
  });

  it("falls back to English when the translation is blank", () => {
    expect(localizedName({ ...saree, nameGu: "" }, "gu")).toBe("Saree");
    expect(localizedName({ ...saree, nameHi: "   " }, "hi")).toBe("Saree");
  });
});

describe("withLocalizedName", () => {
  it("adds one name the screen can use and keeps the rest of the row", () => {
    const row = { id: "c1", sortOrder: 2, active: true, ...saree };
    expect(withLocalizedName(row, "hi")).toEqual({ ...row, name: "साड़ी" });
  });
});

describe("sortByLocalizedName", () => {
  const rows = [
    { sortOrder: 2, nameEn: "Suit", nameHi: "सूट", nameGu: "સૂટ" },
    { sortOrder: 1, nameEn: "Saree", nameHi: "साड़ी", nameGu: "સાડી" },
    { sortOrder: 1, nameEn: "Casual", nameHi: "कैज़ुअल", nameGu: "કેઝ્યુઅલ" },
  ];

  it("keeps the order the admin set, then sorts by name", () => {
    expect(sortByLocalizedName(rows, "en").map((row) => row.name)).toEqual([
      "Casual",
      "Saree",
      "Suit",
    ]);
  });

  it("sorts Gujarati names in Gujarati order", () => {
    expect(sortByLocalizedName(rows, "gu").map((row) => row.name)).toEqual([
      "કેઝ્યુઅલ",
      "સાડી",
      "સૂટ",
    ]);
  });

  it("works on a row that has no sortOrder", () => {
    expect(sortByLocalizedName([saree], "en").map((row) => row.name)).toEqual(["Saree"]);
  });
});
