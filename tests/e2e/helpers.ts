import argon2 from "argon2";
import { expect, type Page } from "@playwright/test";
import en from "../../messages/en.json";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";

// Shared fixtures for the end-to-end specs. Every suite used to build its own user and
// type its own login, and two of them navigated before the login had landed, which made
// a signed-in test look like a permission failure.

export const E2E_PIN = "4839";

export const randomMobile = () =>
  `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;

// `branchId` for a test whose action writes to every manager of the branch: locking an
// account notifies them all in one transaction, and pointing that at the shared branch
// made ten parallel workers queue on the same rows.
export async function makeStaff(role: Role, fullName: string, branchId?: string) {
  const homeBranchId =
    branchId ?? (await db.branch.findFirstOrThrow({ where: { status: "ACTIVE" } })).id;
  return db.user.create({
    data: {
      fullName,
      mobile: randomMobile(),
      role,
      homeBranchId,
      pinHash: await argon2.hash(E2E_PIN),
      mustChangePin: false,
    },
  });
}

// Signs in and waits for the landing screen, so the next navigation cannot race the
// session cookie being set.
//
// The generous timeout is not padding. Every spec funnels through here, so this is where
// the suite's load lands: one argon2 verify — deliberately slow — and then a second hop,
// because "/" is a router that reads the session and sends the person on by role. With
// ten workers on one machine that pair has taken well over the five seconds an expect
// waits by default, and the failure looked like a permission bug rather than a slow test.
export async function signIn(page: Page, mobile: string, role: Role, pin = E2E_PIN) {
  await page.goto("/login");
  await page.getByLabel(en.auth.fields.mobile).fill(mobile);
  await page.getByLabel(en.auth.fields.pin).fill(pin);
  await page.getByRole("button", { name: en.auth.logIn }).click();
  await expect(page).toHaveURL(role === "SALESPERSON" ? /\/today/ : /\/overview/, {
    timeout: 20_000,
  });
}
