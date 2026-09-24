-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `pushedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `notifications_pushedAt_sentAt_idx` ON `notifications`(`pushedAt`, `sentAt`);

-- Rows written before M14 were never meant for a phone: mark them as already handled.
UPDATE `notifications` SET `pushedAt` = `sentAt` WHERE `pushedAt` IS NULL;
