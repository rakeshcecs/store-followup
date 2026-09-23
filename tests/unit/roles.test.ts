import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/client";
import { roles } from "@/lib/roles";

describe("roles", () => {
  // `satisfies` in src/lib/roles.ts catches a role that does not exist; this catches the
  // other direction — a role added to the schema and forgotten here, which would quietly
  // vanish from the staff form and its filter.
  it("lists exactly the roles the schema defines", () => {
    expect([...roles].sort()).toEqual(Object.values(Role).sort());
  });
});
