// Starting data for a fresh database. Safe to run again: every row is upserted.
// Admin login comes from .env (SEED_ADMIN_NAME, SEED_ADMIN_MOBILE, SEED_ADMIN_PIN).
import "dotenv/config";
import argon2 from "argon2";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

const BRANCH_NAME = "[STORE NAME] – Main";

// Extra branch and staff for trying multi-branch locally (SEED_DEMO=true).
// Never set SEED_DEMO in production.
const DEMO_BRANCH_NAME = "[STORE NAME] – Branch 2";

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

const SETTINGS: Record<string, Prisma.InputJsonValue> = {
  reminderTimes: ["09:30", "10:30", "14:00", "17:30"],
  billAmountRequired: false,
  autoWhatsApp: { followUpReminder: false, thankYouAfterSale: false, occasionGreeting: false },
  aiEnabled: false,
  campaignWeeklyLimit: 2,
  occasionLeadDays: 7,
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in .env before seeding.`);
  return value;
}

function demoMobile(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[6-9]\d{9}$/.test(value)) {
    throw new Error(`${name} must be 10 digits starting with 6, 7, 8 or 9.`);
  }
  return value;
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
      create: { name: BRANCH_NAME, address: "[ADDRESS]", city: "[CITY]", phone: "[PHONE]" },
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
      create: { name: DEMO_BRANCH_NAME, address: "[ADDRESS]", city: "[CITY]", phone: "[PHONE]" },
    });

    // A manager of the main branch who also covers branch 2: the only fixture that
    // exercises extra branches, the switcher and cross-branch denial.
    const manager = await tx.user.upsert({
      where: { mobile: demoMobile("SEED_MANAGER_MOBILE", "9000000001") },
      update: {},
      create: {
        fullName: "Demo Manager",
        mobile: demoMobile("SEED_MANAGER_MOBILE", "9000000001"),
        role: "MANAGER",
        homeBranchId: branch.id,
        pinHash,
        mustChangePin: true,
      },
    });

    // Never a row for the home branch itself: it would double-count the person
    // when a branch checks whether any staff still work there.
    await tx.userBranch.upsert({
      where: { userId_branchId: { userId: manager.id, branchId: branch2.id } },
      update: {},
      create: { userId: manager.id, branchId: branch2.id },
    });

    // Salesperson at branch 2 only: the "cannot see the other branch" counterpart.
    await tx.user.upsert({
      where: { mobile: demoMobile("SEED_SALES_MOBILE", "9000000002") },
      update: {},
      create: {
        fullName: "Demo Salesperson",
        mobile: demoMobile("SEED_SALES_MOBILE", "9000000002"),
        role: "SALESPERSON",
        homeBranchId: branch2.id,
        pinHash,
        mustChangePin: true,
      },
    });
  });

  console.log("Seed done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
