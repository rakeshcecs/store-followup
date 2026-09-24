"use server";

import argon2 from "argon2";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { localeCookie, localeCookieMaxAge } from "@/i18n/config";
import { AUDIT, writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { PUSH_COOKIE } from "@/lib/push-device";
import { canResetPin } from "@/lib/staff-scope";
import { safeAction } from "@/lib/safe-action";
import { generateTempPin } from "@/lib/temp-pin";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  hashToken,
  SESSION_COOKIE,
} from "@/lib/session";
import {
  LOCK_MINUTES,
  loginInput,
  MAX_FAILED_ATTEMPTS,
  resetPinInput,
  setPinInput,
} from "@/lib/validation/auth";

// One message for a wrong mobile and a wrong PIN: saying which half was wrong turns the
// login screen into a way of discovering who works here.
const badCredentials = () => new AppError("RULE", { message: "auth.errors.badCredentials" });

// A real argon2 hash of a value nobody can log in with. Verifying against it when the
// mobile is unknown keeps a failed login the same length as a wrong PIN, so timing
// cannot answer "does this number work here?" either.
let dummyHash: string | null = null;
async function equalizeTiming(): Promise<void> {
  dummyHash ??= await argon2.hash("no-such-user");
  await argon2.verify(dummyHash, "wrong");
}

async function device(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

async function currentToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

// Everyone who should know an account locked itself: the managers and admins of that
// person's home branch. M20 builds the screen that reads these.
async function notifyManagersOfLock(
  tx: Prisma.TransactionClient,
  user: { id: string; homeBranchId: string },
): Promise<void> {
  const managers = await tx.user.findMany({
    where: {
      status: "ACTIVE",
      role: { in: ["MANAGER", "ADMIN"] },
      id: { not: user.id },
      OR: [
        { homeBranchId: user.homeBranchId },
        { extraBranches: { some: { branchId: user.homeBranchId } } },
      ],
    },
    select: { id: true },
  });

  if (managers.length === 0) return;
  await tx.notification.createMany({
    data: managers.map((manager) => ({
      userId: manager.id,
      type: "user-locked",
      // The reader's own language is applied when M20 renders it; the row keeps the id.
      message: `user-locked:${user.id}`,
      link: "/staff",
    })),
  });
}

export const login = safeAction({
  name: "login",
  schema: loginInput,
  auth: false, // the only public action: there is no user yet
  handler: async ({ mobile, pin, language }) => {
    const user = await db.user.findUnique({
      where: { mobile },
      select: {
        id: true,
        role: true,
        status: true,
        pinHash: true,
        homeBranchId: true,
        mustChangePin: true,
        failedPinCount: true,
        lockedUntil: true,
      },
    });

    if (!user) {
      await equalizeTiming();
      throw badCredentials();
    }

    if (user.status !== "ACTIVE") {
      throw new AppError("RULE", { message: "auth.errors.inactive" });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      // No field: this belongs to the form, not to one input. The message names the
      // same 15 minutes as LOCK_MINUTES — tests/unit/validation-auth.test.ts keeps the
      // two from drifting apart, because an ActionResult carries a key and no values.
      throw new AppError("RULE", { message: "auth.errors.locked" });
    }

    if (!(await argon2.verify(user.pinHash, pin))) {
      const failedPinCount = user.failedPinCount + 1;
      const locking = failedPinCount >= MAX_FAILED_ATTEMPTS;

      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: locking
            ? {
                failedPinCount: 0,
                lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000),
              }
            : { failedPinCount },
        });

        if (locking) {
          await notifyManagersOfLock(tx, user);
          await writeAudit(tx, {
            userId: user.id,
            branchId: user.homeBranchId,
            action: AUDIT.userLocked,
            entityType: "User",
            entityId: user.id,
            newValue: { minutes: LOCK_MINUTES },
            device: await device(),
          });
        }
      });

      throw badCredentials();
    }

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedPinCount: 0,
          lockedUntil: null,
          // The language picked on the login screen belongs to the person, not the
          // browser, from this moment on (M18.02).
          ...(language ? { language } : {}),
        },
      });
      await createSession(tx, user.id, await device());
    });

    if (language) {
      (await cookies()).set(localeCookie, language, {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: localeCookieMaxAge,
      });
    }

    revalidatePath("/", "layout");
    return { role: user.role, mustChangePin: user.mustChangePin };
  },
});

export const logout = safeAction({
  name: "logout",
  schema: z.object({}),
  auth: {},
  handler: async () => {
    const token = await currentToken();
    if (token) await destroySession(token);
    // This device stops getting their reminders (M14).
    const store = await cookies();
    const endpoint = store.get(PUSH_COOKIE)?.value;
    if (endpoint) {
      await db.pushSubscription.deleteMany({ where: { endpoint } });
      store.delete(PUSH_COOKIE);
    }
    revalidatePath("/", "layout");
    return { ok: true };
  },
});

// The nav bars use this directly as a <form action>: they pass no input and expect to
// land on the login screen, not to read a result.
export async function logoutAndReturnToLogin(): Promise<void> {
  await logout({});
  redirect("/login");
}

export const setPin = safeAction({
  name: "setPin",
  schema: setPinInput,
  auth: {},
  handler: async ({ currentPin, pin }, { user }) => {
    const row = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { pinHash: true, mustChangePin: true },
    });

    // The current PIN is proof it is really you. It is not asked for when the PIN must
    // change anyway — a first login, or a manager's reset, where the old PIN is known
    // to someone else and is exactly what we are replacing.
    if (!row.mustChangePin) {
      if (!currentPin || !(await argon2.verify(row.pinHash, currentPin))) {
        throw new AppError("RULE", {
          message: "auth.errors.currentPinWrong",
          field: "currentPin",
        });
      }
    }

    const token = await currentToken();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { pinHash: await argon2.hash(pin), mustChangePin: false, updatedById: user.id },
      });
      // Any other device holding a session was signed in with the old PIN.
      await destroyAllSessions(tx, user.id, token ? hashToken(token) : undefined);
    });

    revalidatePath("/", "layout");
    return { ok: true };
  },
});

export const resetPin = safeAction({
  name: "resetPin",
  schema: resetPinInput,
  auth: { roles: ["MANAGER", "ADMIN"] },
  handler: async ({ userId, pin }, { user }) => {
    const oneTimePin = pin ?? generateTempPin();
    const target = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        homeBranchId: true,
        extraBranches: { select: { branchId: true } },
      },
    });
    if (!target) throw new AppError("NOT_FOUND");
    // A manager resets their own salespeople only: the PIN comes back to them, so
    // resetting an admin's or another manager's would let them sign in as that person.
    if (!canResetPin(user, target)) throw new AppError("FORBIDDEN");

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        // They choose their own PIN on the next login; this one is a one-time key.
        data: {
          pinHash: await argon2.hash(oneTimePin),
          mustChangePin: true,
          updatedById: user.id,
        },
      });
      // Their devices were signed in with the old PIN.
      await destroyAllSessions(tx, target.id);
      await writeAudit(tx, {
        userId: user.id,
        branchId: target.homeBranchId,
        action: AUDIT.userPinReset,
        entityType: "User",
        entityId: target.id,
        // Never the PIN itself: an audit row is read by other people later.
        device: await device(),
      });
    });

    // The only time this PIN is ever visible. The screen shows it once.
    return { pin: oneTimePin };
  },
});
