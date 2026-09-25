-- WhatsApp is a plain wa.me button (25 Sep 2026): the app never sends, logs or reads a
-- message. The Meta API's tables (messages, unknown contacts, templates), the campaigns
-- built on them, the WhatsApp consent and the import's consent column all go.

-- DropForeignKey
ALTER TABLE `campaigns` DROP FOREIGN KEY `campaigns_branchId_fkey`;

-- DropForeignKey
ALTER TABLE `campaigns` DROP FOREIGN KEY `campaigns_templateId_fkey`;

-- DropForeignKey
ALTER TABLE `whatsapp_messages` DROP FOREIGN KEY `whatsapp_messages_branchId_fkey`;

-- DropForeignKey
ALTER TABLE `whatsapp_messages` DROP FOREIGN KEY `whatsapp_messages_campaignId_fkey`;

-- DropForeignKey
ALTER TABLE `whatsapp_messages` DROP FOREIGN KEY `whatsapp_messages_customerId_fkey`;

-- DropForeignKey
ALTER TABLE `whatsapp_messages` DROP FOREIGN KEY `whatsapp_messages_templateId_fkey`;

-- AlterTable
ALTER TABLE `customers` DROP COLUMN `whatsappConsent`,
    DROP COLUMN `whatsappConsentAt`,
    DROP COLUMN `whatsappLastInAt`;

-- AlterTable
ALTER TABLE `import_jobs` DROP COLUMN `whatsappConfirmed`;

-- DropTable
DROP TABLE `campaigns`;

-- DropTable
DROP TABLE `whatsapp_messages`;

-- DropTable
DROP TABLE `whatsapp_unknown_messages`;

-- DropTable
DROP TABLE `whatsapp_templates`;
