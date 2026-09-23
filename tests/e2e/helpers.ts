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

export async function makeStaff(role: Role, fullName: string) {
  const branch = await db.branch.findFirstOrThrow({ where: { status: "ACTIVE" } });
  return db.user.create({
    data: {
      fullName,
      mobile: randomMobile(),
      role,
      homeBranchId: branch.id,
      pinHash: await argon2.hash(E2E_PIN),
      mustChangePin: false,
    },
  });
}

// Signs in and waits for the landing screen, so the next navigation cannot race the
// session cookie being set.
export async function signIn(page: Page, mobile: string, role: Role, pin = E2E_PIN) {
  await page.goto("/login");
  await page.getByLabel(en.auth.fields.mobile).fill(mobile);
  await page.getByLabel(en.auth.fields.pin).fill(pin);
  await page.getByRole("button", { name: en.auth.logIn }).click();
  await expect(page).toHaveURL(role === "SALESPERSON" ? /\/today/ : /\/overview/);
}
