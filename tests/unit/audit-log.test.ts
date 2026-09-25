import { describe, expect, it } from "vitest";
import { AUDIT } from "@/lib/audit";
import {
  AUDIT_DEFAULT_DAYS,
  AUDIT_KINDS,
  actionsOfKind,
  auditChanges,
  auditKind,
  parseAuditFilters,
} from "@/lib/audit-log";
import { lastFourMatch } from "@/lib/privacy";

// M16: the audit screen's filters and the old → new lines.
describe("audit kinds", () => {
  it("puts every stored action under one of the prompt's actions", () => {
    expect(auditKind(AUDIT.customerCreate)).toBe("CREATE");
    expect(auditKind(AUDIT.saleUpdate)).toBe("UPDATE");
    expect(auditKind(AUDIT.followUpResult)).toBe("UPDATE");
    expect(auditKind(AUDIT.userDeactivate)).toBe("UPDATE");
    expect(auditKind(AUDIT.saleCancel)).toBe("CANCEL");
    expect(auditKind(AUDIT.customerAnonymize)).toBe("DELETE");
    expect(auditKind(AUDIT.reportExport)).toBe("EXPORT");
    expect(auditKind(AUDIT.userLocked)).toBe("LOGIN_LOCK");
    expect(auditKind(AUDIT.customerReassign)).toBe("REASSIGN");
  });

  it("the kinds together cover every action exactly once", () => {
    const all = AUDIT_KINDS.flatMap(actionsOfKind).sort();
    expect(all).toEqual(Object.values(AUDIT).sort());
  });
});

describe("audit filters", () => {
  const today = "2026-09-24";

  it("opens on the last 30 days", () => {
    const f = parseAuditFilters({}, today);
    expect(f.range).toEqual({ from: "2026-08-26", to: today });
    expect(AUDIT_DEFAULT_DAYS).toBe(30);
    expect(f.page).toBe(1);
  });

  it("keeps a valid range and drops junk", () => {
    const f = parseAuditFilters(
      { from: "2026-01-01", to: "2026-02-01", kind: "CANCEL", entity: "Sale", q: " B-1 " },
      today,
    );
    expect(f.range).toEqual({ from: "2026-01-01", to: "2026-02-01" });
    expect(f).toMatchObject({ kind: "CANCEL", entity: "Sale", q: "B-1" });
    const bad = parseAuditFilters({ kind: "DROP", entity: "Job", from: "x", page: "-3" }, today);
    expect(bad.kind).toBeUndefined();
    expect(bad.entity).toBeUndefined();
    expect(bad.page).toBe(1);
  });

  it("falls back when the range is backwards or longer than the 3 years kept", () => {
    expect(parseAuditFilters({ from: "2026-09-10", to: "2026-09-01" }, today).range.to).toBe(today);
    expect(parseAuditFilters({ from: "2020-01-01", to: today }, today).range.from).toBe(
      "2026-08-26",
    );
  });
});

describe("audit changes", () => {
  it("lists only the fields that changed, without bookkeeping", () => {
    expect(
      auditChanges(
        { name: "Asha", area: "Adajan", updatedAt: "a" },
        { name: "Asha Patel", area: "Adajan", updatedAt: "b" },
      ),
    ).toEqual([{ field: "name", from: "Asha", to: "Asha Patel" }]);
  });

  it("a create shows its new values; empty values read as nothing", () => {
    expect(auditChanges(null, { id: "x", billNumber: "B-1", remarks: "" })).toEqual([
      { field: "billNumber", from: null, to: "B-1" },
    ]);
    expect(auditChanges(null, null)).toEqual([]);
  });

  it("cuts long values", () => {
    const [change] = auditChanges({}, { remarks: "x".repeat(200) });
    expect(change!.to!.length).toBe(80);
    expect(change!.to!.endsWith("…")).toBe(true);
  });
});

describe("privacy delete confirmation", () => {
  it("needs exactly the last four digits", () => {
    expect(lastFourMatch("9825012345", "2345")).toBe(true);
    expect(lastFourMatch("9825012345", "1234")).toBe(false);
    expect(lastFourMatch("9825012345", "345")).toBe(false);
    expect(lastFourMatch(null, "2345")).toBe(false);
  });
});
