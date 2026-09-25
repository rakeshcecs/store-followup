// Starting data for a fresh database. Safe to run again: every row is upserted.
// Admin login comes from .env (SEED_ADMIN_NAME, SEED_ADMIN_MOBILE, SEED_ADMIN_PIN).
import "dotenv/config";
import argon2 from "argon2";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { demoPin, demoStaff } from "./demo-store";

const BRANCH_NAME = "Deepak Silk – Branch A";

// Where the branches are. Surat addresses and store phones in the formats the branch
// form accepts, so editing a branch in Settings saves without retyping anything.
const BRANCH_DETAILS = {
  address: "12, Ring Road, near Textile Market",
  city: "Surat",
  phone: "0261 234 5678",
  openingHours: "10 AM to 9 PM",
};

// Extra branch and staff for trying multi-branch locally (SEED_DEMO=true).
// Never set SEED_DEMO in production.
const DEMO_BRANCH_NAME = "Deepak Silk – Branch B";
const DEMO_BRANCH_DETAILS = {
  address: "Shop 5, Ghod Dod Road, near Chowpatty",
  city: "Surat",
  phone: "0261 876 5432",
  openingHours: "10:30 AM to 9:30 PM",
};

const DEPARTMENTS = ["Men's Wear", "Women's Wear", "Kids", "Other"];

// [id, English, Hindi, Gujarati]
const CATEGORIES: [string, string, string, string][] = [
  ["seed-cat-wedding", "Wedding Clothes", "शादी के कपड़े", "લગ્નના કપડાં"],
  ["seed-cat-sherwani", "Sherwani", "शेरवानी", "શેરવાની"],
  ["seed-cat-suit", "Suit", "सूट", "સૂટ"],
  ["seed-cat-saree", "Saree", "साड़ी", "સાડી"],
  ["seed-cat-casual", "Casual Wear", "कैज़ुअल कपड़े", "કેઝ્યુઅલ કપડાં"],
  ["seed-cat-festival", "Festival Collection", "त्योहार कलेक्शन", "તહેવાર કલેક્શન"],
  ["seed-cat-family", "Family Shopping", "परिवार की खरीदारी", "પરિવારની ખરીદી"],
  ["seed-cat-bulk", "Bulk Purchase", "थोक खरीद", "જથ્થાબંધ ખરીદી"],
  ["seed-cat-other", "Other", "अन्य", "અન્ય"],
];

const LOST_REASONS: [string, string, string, string][] = [
  ["seed-lost-price", "Price", "कीमत", "કિંમત"],
  ["seed-lost-design", "Design not available", "डिज़ाइन उपलब्ध नहीं", "ડિઝાઇન ઉપલબ્ધ નથી"],
  ["seed-lost-size", "Size not available", "साइज़ उपलब्ध नहीं", "સાઇઝ ઉપલબ્ધ નથી"],
  ["seed-lost-elsewhere", "Bought elsewhere", "कहीं और से खरीदा", "બીજે ક્યાંકથી ખરીદ્યું"],
  ["seed-lost-other", "Other", "अन्य", "અન્ય"],
];

// The bill amount switch is not seeded: no row means "required" (src/lib/settings.ts, M10).
const SETTINGS: Record<string, Prisma.InputJsonValue> = {
  reminderTimes: ["09:30", "10:30", "14:00", "17:30"],
  aiEnabled: false,
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in .env before seeding.`);
  return value;
}

// Printed after a demo seed so the logins do not have to be looked up every reset.
// PINs are only ever set when a row is created, so these are the real ones only until
// somebody changes theirs.
function printDemoLogins(adminMobile: string, adminPin: string): void {
  console.table([
    { who: "Admin", branch: "All", mobile: adminMobile, pin: `${adminPin} (must change)` },
    ...demoStaff("Branch A", "Branch B").map((person) => ({
      who: person.fullName,
      branch: person.homeBranchId + (person.extraBranchIds.length ? " + Branch B" : ""),
      mobile: person.mobile,
      pin: demoPin(),
    })),
  ]);
}

async function main() {
  const adminName = requireEnv("SEED_ADMIN_NAME");
  const adminMobile = requireEnv("SEED_ADMIN_MOBILE");
  const adminPin = requireEnv("SEED_ADMIN_PIN");
  if (!/^[6-9]\d{9}$/.test(adminMobile)) {
    throw new Error("SEED_ADMIN_MOBILE must be 10 digits starting with 6, 7, 8 or 9.");
  }
  if (!/^\d{4}$/.test(adminPin)) throw new Error("SEED_ADMIN_PIN must be 4 digits.");
  const pinHash = await argon2.hash(adminPin);

  await db.$transaction(async (tx) => {
    const branch = await tx.branch.upsert({
      where: { name: BRANCH_NAME },
      update: {},
      create: { name: BRANCH_NAME, ...BRANCH_DETAILS },
    });

    // PIN is only set on first create, so re-seeding never resets a changed PIN.
    await tx.user.upsert({
      where: { mobile: adminMobile },
      update: {},
      create: {
        fullName: adminName,
        mobile: adminMobile,
        role: "ADMIN",
        homeBranchId: branch.id,
        pinHash,
        mustChangePin: true,
      },
    });

    for (const name of DEPARTMENTS) {
      await tx.department.upsert({ where: { name }, update: {}, create: { name } });
    }

    for (const [index, [id, nameEn, nameHi, nameGu]] of CATEGORIES.entries()) {
      const data = { nameEn, nameHi, nameGu, sortOrder: index + 1 };
      await tx.requirementCategory.upsert({ where: { id }, update: data, create: { id, ...data } });
    }

    for (const [index, [id, nameEn, nameHi, nameGu]] of LOST_REASONS.entries()) {
      const data = { nameEn, nameHi, nameGu, sortOrder: index + 1 };
      await tx.lostReason.upsert({ where: { id }, update: data, create: { id, ...data } });
    }

    for (const [key, value] of Object.entries(SETTINGS)) {
      await tx.setting.upsert({ where: { key }, update: {}, create: { key, value } });
    }

    if (process.env["SEED_DEMO"] !== "true") return;

    const branch2 = await tx.branch.upsert({
      where: { name: DEMO_BRANCH_NAME },
      update: {},
      create: { name: DEMO_BRANCH_NAME, ...DEMO_BRANCH_DETAILS },
    });

    // Demo staff have their own PIN and skip the forced change: this store exists to be
    // logged into straight after a reset, and changing four PINs first defeats that. The
    // admin keeps mustChangePin, so the "first login must replace the seeded PIN" path
    // is still real — tests/e2e/fresh-install.spec.ts checks exactly that.
    const demoPinHash = await argon2.hash(demoPin());

    for (const person of demoStaff(branch.id, branch2.id)) {
      const user = await tx.user.upsert({
        where: { mobile: person.mobile },
        update: {},
        create: {
          fullName: person.fullName,
          mobile: person.mobile,
          role: person.role,
          homeBranchId: person.homeBranchId,
          pinHash: demoPinHash,
          mustChangePin: false,
        },
      });

      // Never a row for the home branch itself: it would double-count the person when a
      // branch checks whether any staff still work there.
      for (const branchId of person.extraBranchIds) {
        await tx.userBranch.upsert({
          where: { userId_branchId: { userId: user.id, branchId } },
          update: {},
          create: { userId: user.id, branchId },
        });
      }
    }
  });

  console.log("Seed done.");
  if (process.env["SEED_DEMO"] === "true") printDemoLogins(adminMobile, adminPin);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
