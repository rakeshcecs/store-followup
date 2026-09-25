-- DropForeignKey
ALTER TABLE `timeline_events` DROP FOREIGN KEY `timeline_events_staffId_fkey`;

-- DropIndex
DROP INDEX `timeline_events_staffId_fkey` ON `timeline_events`;

-- AlterTable
ALTER TABLE `customers` ADD COLUMN `whatsappLastInAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `timeline_events` MODIFY `staffId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `whatsapp_messages` ADD COLUMN `dedupeKey` VARCHAR(120) NULL,
    ADD COLUMN `deliveredAt` DATETIME(3) NULL,
    ADD COLUMN `errorCode` VARCHAR(20) NULL,
    ADD COLUMN `kind` ENUM('TEMPLATE', 'TEXT', 'THANK_YOU', 'VISIT_REMINDER', 'OCCASION', 'CAMPAIGN', 'INCOMING') NOT NULL DEFAULT 'TEMPLATE',
    ADD COLUMN `readAt` DATETIME(3) NULL,
    ADD COLUMN `sentAt` DATETIME(3) NULL,
    ADD COLUMN `variables` JSON NULL;

-- AlterTable
ALTER TABLE `whatsapp_templates` ADD COLUMN `mapping` JSON NULL,
    ADD COLUMN `metaId` VARCHAR(64) NULL,
    ADD COLUMN `metaLanguage` VARCHAR(15) NOT NULL DEFAULT 'en',
    ADD COLUMN `metaStatusText` VARCHAR(30) NULL,
    ADD COLUMN `syncedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `whatsapp_unknown_messages` (
    `id` VARCHAR(191) NOT NULL,
    `fromMobile` VARCHAR(20) NOT NULL,
    `profileName` VARCHAR(100) NULL,
    `body` TEXT NOT NULL,
    `metaMessageId` VARCHAR(128) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `handledAt` DATETIME(3) NULL,
    `handledById` VARCHAR(191) NULL,

    UNIQUE INDEX `whatsapp_unknown_messages_metaMessageId_key`(`metaMessageId`),
    INDEX `whatsapp_unknown_messages_handledAt_receivedAt_idx`(`handledAt`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `whatsapp_messages_dedupeKey_key` ON `whatsapp_messages`(`dedupeKey`);

-- AddForeignKey
ALTER TABLE `timeline_events` ADD CONSTRAINT `timeline_events_staffId_fkey` FOREIGN KEY (`staffId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
