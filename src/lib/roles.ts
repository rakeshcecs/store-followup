// The roles as plain data, for code that runs in the browser.
//
// Importing the enum from @/generated/prisma/client as a *value* drags the Prisma client
// into the client bundle, and Turbopack refuses it: "the chunking context does not
// support external modules (request: node:module)". A type-only import is erased, and
// `satisfies` still fails the build if the enum ever gains a role this list is missing.
import type { Role } from "@/generated/prisma/client";

export const roles = ["SALESPERSON", "MANAGER", "ADMIN"] as const satisfies readonly Role[];

// tests/unit/roles.test.ts checks this list against the enum itself, which is the half
// `satisfies` cannot see: a role removed from here would still type-check.
